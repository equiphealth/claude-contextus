#!/usr/bin/env node
/**
 * Contextus daemon — the persistent HTTP server that makes proactive injection
 * fast (DESIGN.md §"Phase 2: Daemon + HTTP Architecture").
 *
 * Why a daemon: loading the embedding model takes seconds. A fresh Node process
 * per UserPromptSubmit hook would pay that every prompt. The daemon loads the
 * model ONCE at boot, then all hooks are thin HTTP clients hitting localhost.
 *
 * Single shared daemon across all projects (one model in memory); project
 * isolation is by the `project` request field → per-project LanceDB dir. Built
 * on Node's stdlib `http` — no framework dependency in the hot path.
 *
 * Endpoints (see docs/API.md for full reference):
 *   GET  /health          → { status, uptime, modelLoaded, lancedbConnected, embeddingModel }
 *   GET  /novelty         → { project, recent: string[] } — recently-injected patterns
 *   GET  /introspect      → live config + corpus stats (Self-doc Layer 1)
 *   POST /query   {project, prompt}                              → { continue, hookSpecificOutput?: { additionalContext } }
 *   POST /notify  {project, file, cwd?}                          → { ok, embedded, id? }
 *   POST /capture {category, slug, description, body, cwd, ...}  → { ok, file, embedded, scope } (overwrites existing)
 *   POST /delete  {relPath, cwd, scope?, project?}               → { ok, archived, removedFromIndex, embeddingsRemoved }
 *   POST /reconcile {project, cwd, check?}                       → { state, started? } | { state, embedded, removed }
 *
 * The pipeline on /query is the spine: embedQuery → vector search → rerank →
 * floor → format. Floor-dropped chunks are logged with scores (v2 governance
 * groundwork). No-inject is a first-class, logged success.
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { loadConfig, loadProjectConfig, expandHome, projectHash } from '../lib/config.js';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { warmup, embedQuery } from '../lib/embedding/embedder.js';
import {
  search,
  tableExists,
  readTableMeta,
  incrementHits,
  getContentHashes,
  deleteByFilename
} from '../lib/storage/lance-client.js';
import { estimateTokens } from '../lib/retrieval/inject-format.js';
import { expandQuery, shouldExpand } from '../lib/retrieval/expand.js';
import {
  keywordSearch,
  loadCorpusForKeyword,
  invalidateCorpusCache
} from '../lib/retrieval/keyword.js';
import { fuseRRF, hybridKeywordSearch } from '../lib/retrieval/hybrid.js';
import { processSearchResults } from '../lib/retrieval/pipeline.js';
import { recordInjection, noveltyFor } from '../lib/capture/novelty.js';
import { embedSingleFile } from '../lib/embedding/embed-file.js';
import { upsertIndexEntry } from '../lib/capture/context-index.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { planReconcile, type DiskFile } from '../lib/storage/reconcile.js';
import { loadContexts, quarantineMismatches } from '../lib/embedding/context-loader.js';
import {
  resolveProjectScope,
  registerProject,
  resolveProjectId,
  isValidProjectDir
} from '../lib/workspace.js';
import { recordLastInjection } from '../lib/session-state.js';
import {
  readState as readCalibrationState,
  startCalibration
} from '../lib/calibration/calibration-state.js';
import { buildIntrospection } from '../lib/introspect.js';
import {
  logRetrieval,
  logNoInject,
  logParanoid,
  logError,
  logInfo,
  promptHash
} from '../lib/logger.js';
import { rotateLogsOnStartup } from '../lib/log-rotation.js';
import { startEvalLoop, stopEvalLoop } from './eval-loop.js';
import { writeLastInjectionDebug, type LastInjectionDebug } from '../lib/debug-statusline.js';

/** Preferred daemon port (fallback to OS-assigned if unavailable). */
const PREFERRED_PORT = parseInt(process.env.CONTEXTUS_DAEMON_PORT || '37800', 10);
let actualPort: number = PREFERRED_PORT;
const BASE_URL = () => `http://127.0.0.1:${actualPort}`;
/** Daemon/protocol version read from package.json at startup. */
const DAEMON_VERSION = (() => {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const pkgPath = path.join(__dirname, '../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
})();
const RUNTIME_DIR = expandHome('~/.contextus/runtime');
const CAPTURES_LOG = expandHome('~/.contextus/captures.log');
const PID_PATH = path.join(RUNTIME_DIR, 'daemon.pid');
const PORT_PATH = path.join(RUNTIME_DIR, 'daemon.port');

/** Append a capture event to the audit log (best-effort, never blocks). */
function logCapture(scope: string, file: string, description: string): void {
  const line = `${new Date().toISOString()} | ${scope} | ${file} | ${JSON.stringify(description)}\n`;
  try {
    fs.appendFileSync(CAPTURES_LOG, line);
  } catch {
    // Best-effort — never fail a capture on log I/O
  }
}

/** Set true once the embedding model has warm-loaded; /health gates on it. */
let modelLoaded = false;
/** In-memory query stats (reset on daemon restart). */
const stats = { queries: 0, expansionFired: 0, expansionSkipped: 0 };
/**
 * Set when warmup() REJECTS (provider unreachable, model missing, dim mismatch).
 * Distinguishes a hard failure from "still loading" so session-start can tell the
 * user the truth (provider down → no injection this session) instead of the
 * misleading "still warming" (which implies transient). Null = no failure yet.
 */
let warmupError: string | null = null;

/**
 * Capture request queue — prevents silent drops when daemon is busy embedding.
 * Requests queue up and process sequentially without blocking the event loop.
 *
 * ROOT CAUSE: When daemon is busy (e.g., embedSingleFile in progress), any handler
 * that throws propagates to the catch block at line ~1162, which returns
 * `{continue: true}` (hook response) instead of proper capture response. This queue
 * ensures captures never throw to that catch by serializing and error-handling them.
 */
interface CaptureQueueItem {
  body: Record<string, unknown>;
  res: http.ServerResponse;
}
const MAX_CAPTURE_QUEUE_SIZE = 100; // Prevent memory exhaustion under load
const captureQueue: CaptureQueueItem[] = [];
let processingCapture = false;

/** Read a JSON request body (bounded; rejects malformed/oversized). */
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data.trim()) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

/** GET /health — liveness + readiness (modelLoaded is what session-start polls).
 *  ?probe=true → verify the provider is actually reachable (cheap embed). */
async function handleHealth(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const cfg = loadConfig();

  // Liveness probe: if model appears warm, verify the provider is still up.
  const url = new URL(req.url ?? '/', BASE_URL());
  if (url.searchParams.get('probe') === 'true' && modelLoaded) {
    try {
      await embedQuery('health');
    } catch (err) {
      modelLoaded = false;
      warmupError = err instanceof Error ? err.message : String(err);
      logError('warn', 'embedder', 'Health probe failed — provider down, triggering re-warmup', {
        message: warmupError
      });
      if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
      attemptWarmup();
    }
  }

  const expansionRate =
    stats.queries > 0 ? Number(((stats.expansionFired / stats.queries) * 100).toFixed(1)) : 0;
  sendJson(res, 200, {
    status: 'ok',
    version: DAEMON_VERSION,
    installRoot: path.resolve(__dirname, '..'),
    uptime: process.uptime(),
    modelLoaded,
    warmupError,
    lancedbConnected: true,
    embeddingModel:
      cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model,
    provider: cfg.embedding.provider,
    expansion: {
      mode: cfg.expansion.mode,
      queries: stats.queries,
      fired: stats.expansionFired,
      skipped: stats.expansionSkipped,
      fireRate: `${expansionRate}%`
    }
  });
}

/**
 * POST /query — the retrieval spine. Embeds the prompt, searches the project's
 * corpus, re-ranks, applies the floor, formats. Returns the UserPromptSubmit
 * hook payload shape directly so the hook is a pure pass-through.
 */
async function handleQuery(body: Record<string, unknown>, res: http.ServerResponse): Promise<void> {
  const started = Date.now();
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const sessionId =
    typeof body.sessionId === 'string' && body.sessionId ? body.sessionId : undefined;
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;
  // cwd = the project repo root, needed for the git-committed tier-3 config override.
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
  // Normalize project identifier (accepts hash, name, or path) to canonical hash.
  // Falls back to hashing cwd for legacy callers that don't send project yet.
  const projectId = project ? resolveProjectId(project) : cwd ? projectHash(cwd) : undefined;
  // Resolve workspace scope: self + siblings + __user__
  const projectScope = cwd
    ? resolveProjectScope(cwd)
    : projectId
      ? [projectId, '__user__']
      : undefined;

  // Lazy-register project for hash→name reverse lookup
  if (projectId && cwd) registerProject(projectId, cwd);

  if (!prompt.trim()) {
    return sendJson(res, 200, { continue: true });
  }

  const hash = promptHash(prompt);
  const projectLabel = project ?? 'default';

  // Model not warm yet (still loading, or warmup failed) → degrade. Embedding
  // now would throw deep in the provider; the cold first prompt or two missing
  // context is the documented graceful-degradation behavior.
  if (!modelLoaded) {
    logInfo('Query before model warm — skipping', { project: projectLabel });
    return sendJson(res, 200, { continue: true });
  }

  // No corpus yet for this project → silently inject nothing (not an error).
  if (!(await tableExists(projectId))) {
    logInfo('No corpus for project — skipping', { project: projectLabel });
    return sendJson(res, 200, { continue: true });
  }

  // Validate query-time embedding space matches build-time (DESIGN.md model
  // consistency). Both the model id AND the dimensions must agree — a mismatch on
  // either means the query vector and the stored vectors live in different spaces,
  // so similarities are meaningless. Fail fast + degrade rather than inject noise.
  // Project-aware: floor/topK/etc. resolve through the 3-tier merge (global →
  // machine-local → git-committed), so each project calibrates independently.
  const cfg = loadProjectConfig(projectId, cwd);
  const meta = readTableMeta(projectId);
  const activeModel =
    cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model;
  if (meta && meta.embeddingModel !== activeModel) {
    logError('error', 'daemon', 'Embedding model mismatch (corpus vs daemon)', {
      project: projectLabel,
      corpus: meta.embeddingModel,
      daemon: activeModel,
      fix: 're-embed the corpus with the active model (pnpm run embed) or restore the build-time model'
    });
    // Degrade gracefully — a mismatched space yields garbage similarities.
    return sendJson(res, 200, { continue: true });
  }
  if (meta && meta.dimensions !== cfg.embedding.dimensions) {
    logError('error', 'daemon', 'Embedding dimension mismatch (corpus vs daemon)', {
      project: projectLabel,
      corpus: meta.dimensions,
      daemon: cfg.embedding.dimensions,
      fix: 're-embed the corpus (pnpm run embed) so stored vectors match config.embedding.dimensions'
    });
    return sendJson(res, 200, { continue: true });
  }

  // --- Token capacity guard (GitHub #17) ---
  // The statusline script writes context_window stats to a file; the query hook
  // reads it and passes it here. When the conversation is near the model limit,
  // suppress injection to prevent API overflow errors.
  const contextStats = body.contextStats as
    | {
        input_tokens?: number;
        output_tokens?: number;
        used_percentage?: number;
      }
    | undefined;

  let capacityTopK: number | undefined;
  let capacityFloorMultiplier = 1.0;
  let capacityTier: LastInjectionDebug['capacityTier'] = 'none';

  if (
    contextStats?.used_percentage &&
    contextStats.used_percentage > 0 &&
    cfg.capacityProtection.enabled !== false
  ) {
    const pct = contextStats.used_percentage;
    const cpCfg = cfg.capacityProtection;
    const disableAt = cpCfg?.disableAt ?? 85;
    const minimalAt = cpCfg?.minimalAt ?? 80;
    const reduceAt = cpCfg?.reduceAt ?? 70;

    if (pct > disableAt) {
      logInfo('Token capacity exceeded — disabling injection', {
        project: projectLabel,
        used_percentage: Math.round(pct),
        input_tokens: contextStats.input_tokens
      });
      writeLastInjectionDebug(sessionId, projectId, {
        project: projectLabel,
        injected: false,
        count: 0,
        candidates: 0,
        bestScore: 0,
        floor: cfg.retrieval.injectionFloor,
        topK: cfg.retrieval.topK,
        tokensInjected: 0,
        latencyMs: Date.now() - started,
        expansion: 'off',
        hybrid: 'off',
        capacityTier: 'disabled',
        sources: {},
        injectedFiles: []
      });
      return sendJson(res, 200, {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `[contextus: conversation at ${Math.round(pct)}% capacity (${Math.round((contextStats.input_tokens || 0) / 1000)}K tokens), injection disabled to prevent overflow]`
        }
      });
    }
    if (pct > minimalAt) {
      capacityTopK = 1;
      capacityFloorMultiplier = 1.2;
      capacityTier = 'minimal';
      logInfo('Token capacity high — minimal injection', {
        project: projectLabel,
        used_percentage: Math.round(pct),
        adjustedTopK: 1
      });
    } else if (pct > reduceAt) {
      capacityTopK = Math.min(cfg.retrieval.topK, 3);
      capacityTier = 'reduced';
      logInfo('Token capacity moderate — reducing injection', {
        project: projectLabel,
        used_percentage: Math.round(pct),
        adjustedTopK: capacityTopK
      });
    }
  }

  // --- Embedding + vector search (with hybrid fusion + keyword fallback + auto-recovery) ---
  // When hybrid='always': run keyword search in parallel with vector search, then
  // fuse via RRF. When embedding genuinely fails (provider down), degrade to
  // keyword-only (with auto-recovery trigger) so users get SOME context rather than complete silence.
  let raw: Awaited<ReturnType<typeof search>>;
  let usedKeywordFallback = false;
  let hybridStatus: LastInjectionDebug['hybrid'] =
    cfg.retrieval.hybrid === 'off'
      ? 'off'
      : cfg.retrieval.hybrid === 'always'
        ? 'always'
        : 'adaptive-skip';
  try {
    const effectiveTopK = capacityTopK ?? cfg.retrieval.topK;
    const CHUNK_FANOUT = 4;
    const fetchLimit = effectiveTopK * CHUNK_FANOUT;

    // Always start with semantic search (workspace-scoped)
    const vec = await embedQuery(prompt);
    raw = await search(vec, fetchLimit, undefined, projectId, projectScope);

    if (cfg.retrieval.hybrid === 'always') {
      // Always-on hybrid: fuse keyword + semantic unconditionally
      const corpus = await loadCorpusForKeyword(projectId, projectScope);
      const keywordResults = hybridKeywordSearch(corpus, prompt, cfg.retrieval.topK);
      if (keywordResults.length > 0) {
        raw = fuseRRF(raw, keywordResults, fetchLimit);
      }
    } else if (cfg.retrieval.hybrid === 'adaptive') {
      // Adaptive hybrid: only augment with keyword when semantic scores are weak.
      // Rescues exact-symbol queries ("getLogger") that embed poorly but BM25 nails.
      const semanticBest = raw.length > 0 ? Math.max(...raw.map((r) => r.similarity)) : 0;
      if (semanticBest < cfg.retrieval.injectionFloor) {
        const corpus = await loadCorpusForKeyword(projectId, projectScope);
        const keywordResults = hybridKeywordSearch(corpus, prompt, cfg.retrieval.topK);
        if (keywordResults.length > 0) {
          raw = fuseRRF(raw, keywordResults, fetchLimit);
          hybridStatus = 'adaptive-fired';
        }
      }
    }
    // hybrid === 'off': pure semantic, keyword only as error fallback (below)
  } catch (embedErr) {
    // Provider dropped mid-session — mark down and trigger re-warmup so the
    // daemon recovers automatically once the provider comes back.
    modelLoaded = false;
    warmupError = embedErr instanceof Error ? embedErr.message : String(embedErr);
    logError(
      'warn',
      'embedder',
      'Embedding failed, attempting keyword fallback + triggering re-warmup',
      {
        project: projectLabel,
        message: warmupError
      }
    );
    if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
    attemptWarmup();

    // Try keyword fallback before giving up entirely
    const corpus = await loadCorpusForKeyword(projectId, projectScope);
    if (corpus.length === 0) {
      writeLastInjectionDebug(sessionId, projectId, {
        project: projectLabel,
        injected: false,
        count: 0,
        candidates: 0,
        bestScore: 0,
        floor: cfg.retrieval.injectionFloor,
        topK: cfg.retrieval.topK,
        tokensInjected: 0,
        latencyMs: Date.now() - started,
        expansion: 'off',
        hybrid: 'off',
        capacityTier,
        sources: {},
        injectedFiles: []
      });
      return sendJson(res, 200, { continue: true });
    }
    const keywordResults = keywordSearch(corpus, prompt, cfg.retrieval.topK);
    if (keywordResults.length === 0) {
      logInfo('Keyword fallback: no matches', { project: projectLabel });
      writeLastInjectionDebug(sessionId, projectId, {
        project: projectLabel,
        injected: false,
        count: 0,
        candidates: 0,
        bestScore: 0,
        floor: cfg.retrieval.injectionFloor,
        topK: cfg.retrieval.topK,
        tokensInjected: 0,
        latencyMs: Date.now() - started,
        expansion: 'off',
        hybrid: 'keyword-fallback',
        capacityTier,
        sources: {},
        injectedFiles: []
      });
      return sendJson(res, 200, { continue: true });
    }
    raw = keywordResults;
    usedKeywordFallback = true;
    hybridStatus = 'keyword-fallback';
    logInfo('Keyword fallback fired', {
      project: projectLabel,
      results: keywordResults.length
    });
  }

  // --- Multi-vector query expansion ---
  // Check if expansion should fire (adaptive: best initial score below threshold,
  // always: every query, off: never). When it fires, generate variant phrasings,
  // embed each in parallel, search each, and union with the original results.
  const initialBest = raw.length > 0 ? Math.max(...raw.map((r) => r.similarity)) : 0;
  stats.queries++;
  let expansionStatus: LastInjectionDebug['expansion'] =
    cfg.expansion.mode === 'off' ? 'off' : 'skipped';
  if (
    !usedKeywordFallback &&
    shouldExpand(cfg.expansion.mode, initialBest, cfg.expansion.expansionThreshold)
  ) {
    const expanded = await expandQuery(prompt, cfg.expansion, cfg.providers);
    if (expanded.variants.length > 0) {
      stats.expansionFired++;
      expansionStatus = 'fired';
      // Variants use a smaller fetch limit — the union provides breadth,
      // so each individual variant doesn't need the full CHUNK_FANOUT over-fetch.
      const variantLimit = cfg.retrieval.topK * 2;
      const variantSearches = await Promise.all(
        expanded.variants.map(async (variant) => {
          const vVec = await embedQuery(variant);
          return search(vVec, variantLimit, undefined, projectId, projectScope);
        })
      );
      // Union: merge all results, dedupe by row id (keep highest similarity).
      const originalCount = raw.length;
      const seen = new Map<string, (typeof raw)[0]>();
      for (const r of raw) seen.set(r.id, r);
      for (const results of variantSearches) {
        for (const r of results) {
          const existing = seen.get(r.id);
          if (!existing || r.similarity > existing.similarity) {
            seen.set(r.id, r);
          }
        }
      }
      raw = Array.from(seen.values());
      logInfo('Expansion fired', {
        project: projectLabel,
        variants: expanded.variants,
        provider: expanded.provider,
        latencyMs: expanded.latencyMs,
        resultsBefore: originalCount,
        resultsAfter: raw.length
      });
    }
  } else if (cfg.expansion.mode !== 'off') {
    stats.expansionSkipped++;
    logInfo('Expansion skipped', {
      project: projectLabel,
      initialBest: Number(initialBest.toFixed(4)),
      threshold: cfg.expansion.expansionThreshold
    });
  }

  // --- Post-search pipeline (testable core in lib/retrieval/pipeline.ts) ---
  const outcome = processSearchResults(
    raw,
    {
      topK: capacityTopK ?? cfg.retrieval.topK,
      injectionFloor: cfg.retrieval.injectionFloor * capacityFloorMultiplier,
      maxTokens: cfg.retrieval.maxTokens,
      provenanceFooter: cfg.retrieval.provenanceFooter
    },
    { cwd, usedKeywordFallback }
  );

  if (outcome.kind === 'no-inject' || outcome.kind === 'near-miss') {
    logNoInject({
      project: projectLabel,
      promptHash: hash,
      bestScore: Number(outcome.bestScore.toFixed(4)),
      promptTokens: estimateTokens(prompt),
      latencyMs: Date.now() - started,
      floorDropped: outcome.floorDropped
    });
    writeLastInjectionDebug(sessionId, projectId, {
      project: projectLabel,
      injected: false,
      count: 0,
      candidates: raw.length,
      bestScore: outcome.bestScore,
      floor: cfg.retrieval.injectionFloor * capacityFloorMultiplier,
      topK: capacityTopK ?? cfg.retrieval.topK,
      tokensInjected: 0,
      latencyMs: Date.now() - started,
      expansion: expansionStatus,
      hybrid: hybridStatus,
      capacityTier,
      sources: {},
      injectedFiles: []
    });
    if (cfg.logging.paranoid) {
      logParanoid({
        project: projectLabel,
        promptHash: hash,
        prompt,
        injection: '',
        retrieved: [],
        similarityScores: [Number(outcome.bestScore.toFixed(4))],
        latencyMs: Date.now() - started
      });
    }
    if (outcome.kind === 'near-miss') {
      return sendJson(res, 200, {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: outcome.notice
        }
      });
    }
    return sendJson(res, 200, { continue: true });
  }

  // outcome.kind === 'inject'
  const { block, included, tokens } = outcome;
  const injectedNames = included.map((r) => r.filename || r.id);

  // Learn from this injection (best-effort, off the response path):
  //  - bump hit_count so the re-ranker favors patterns that actually surface
  //  - remember the set so /novelty can tell the awareness hook what we have
  incrementHits(
    included.map((r) => r.id),
    projectId
  ).catch((err) =>
    logError('warn', 'daemon', 'hit-count update failed', {
      message: err instanceof Error ? err.message : String(err)
    })
  );
  recordInjection(projectLabel, injectedNames);

  // While a calibration campaign is active, stash what we injected so the Stop
  // hook can grade usage against it (evaluation-architecture). Skipped entirely
  // when calibration is off — no disk churn on the normal hot path.
  if (readCalibrationState().evaluateUsage) {
    recordLastInjection(projectLabel, {
      promptHash: hash,
      patterns: included.map((r) => ({
        id: r.filename || r.id,
        snippet: r.document.replace(/\s+/g, ' ').slice(0, 160)
      })),
      timestamp: new Date().toISOString()
    });
  }

  logRetrieval({
    project: projectLabel,
    promptHash: hash,
    retrieved: injectedNames,
    similarityScores: included.map((r) => Number(r.similarity.toFixed(4))),
    tokensInjected: tokens,
    promptTokens: estimateTokens(prompt),
    latencyMs: Date.now() - started,
    floorDropped: outcome.floorDropped
  });

  if (cfg.logging.paranoid) {
    logParanoid({
      project: projectLabel,
      promptHash: hash,
      prompt,
      injection: block,
      retrieved: injectedNames,
      similarityScores: included.map((r) => Number(r.similarity.toFixed(4))),
      latencyMs: Date.now() - started
    });
  }

  const sourceCounts: Record<string, number> = {};
  for (const r of included) sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
  writeLastInjectionDebug(sessionId, projectId, {
    project: projectLabel,
    injected: true,
    count: included.length,
    candidates: raw.length,
    bestScore: Math.max(...included.map((r) => r.similarity)),
    floor: cfg.retrieval.injectionFloor * capacityFloorMultiplier,
    topK: capacityTopK ?? cfg.retrieval.topK,
    tokensInjected: tokens,
    latencyMs: Date.now() - started,
    expansion: expansionStatus,
    hybrid: hybridStatus,
    capacityTier,
    sources: sourceCounts,
    injectedFiles: injectedNames
  });

  sendJson(res, 200, {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: block
    }
  });
}

/**
 * Determine which source a file belongs to based on its path and config.
 * Returns { sourceName, sourceDir, projectId, project } or null if no match.
 *
 * Reads the 3-tier MERGED config (loadProjectConfig), not the raw plugin
 * manifest — a project's `.claude/contextus.jsonc` can disable a source,
 * change its path, or add excludes, and /notify's routing must honor that
 * the same way the manual `pnpm embed` CLI already does (see GH issue #22;
 * this used to call findPluginConfig(), which ignores project overrides).
 *
 * Exported for direct unit testing: it's a pure decision function (no I/O
 * beyond reading config), and /notify's actual HTTP response depends on the
 * embedding provider being reachable (embedSingleFile calls the real
 * embedder) — /notify is hook-triggered, so it correctly degrades to
 * `{continue: true}` on ANY internal failure, same as /query, which makes
 * "did routing succeed" unobservable from the HTTP response alone in an
 * environment with no embedding provider (e.g. CI). Testing this function
 * directly avoids that entirely.
 */
export function determineSource(
  absFile: string,
  cwd: string,
  project: string | undefined
): {
  sourceName: string;
  sourceDir: string;
  sourceType?: string;
  projectId: string;
  project: string | undefined;
} | null {
  const projectIdForConfig = project ? resolveProjectId(project) : projectHash(cwd);
  const cfg = loadProjectConfig(projectIdForConfig, cwd);
  const sources = cfg.sources as Record<
    string,
    {
      scope: 'project' | 'user';
      path: string;
      type?: string;
      enabled?: boolean;
    }
  >;

  for (const [sourceName, s] of Object.entries(sources)) {
    if (s.enabled === false) continue;

    const sourceDir = s.scope === 'project' ? path.join(cwd, s.path) : expandHome(s.path);

    if (absFile.startsWith(sourceDir + path.sep) || absFile === sourceDir) {
      // Reuse the already-canonicalized projectIdForConfig (resolveProjectId()/
      // projectHash()) rather than the raw `project` label — the old `project ??
      // projectHash(cwd)` fallback returned an UNRESOLVED name/path verbatim
      // whenever a caller passed one, so rows for the same project could end up
      // scoped under two different projectId strings depending on how the
      // caller referred to it (GH issue #56 — same normalization gap that hit
      // reconcilingProjects's dedup key).
      const pid = s.scope === 'project' ? projectIdForConfig : '';
      const proj = s.scope === 'project' ? project : undefined;
      return { sourceName, sourceDir, sourceType: s.type, projectId: pid, project: proj };
    }
  }

  return null;
}

/**
 * POST /notify — incremental re-embed on file change (PostToolUse). `file` is the
 * changed path; `cwd` (project root) locates `.claude/context`. Best-effort:
 * non-context files are skipped, not errored.
 */
async function handleNotify(
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<void> {
  const file = typeof body.file === 'string' ? body.file : '';
  const projectParam = typeof body.project === 'string' && body.project ? body.project : undefined;
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
  if (!file) return sendJson(res, 200, { ok: true, embedded: false, reason: 'no_file' });
  if (!cwd) return sendJson(res, 400, { error: 'cwd is required for notify' });
  if (!isValidProjectDir(cwd)) {
    return sendJson(res, 400, { error: `cwd is not an existing absolute directory: ${cwd}` });
  }

  const absFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const sourceInfo = determineSource(absFile, cwd, projectParam);

  if (!sourceInfo) {
    return sendJson(res, 200, { ok: true, embedded: false, reason: 'not_in_any_source' });
  }

  const { sourceName, sourceDir, sourceType, projectId, project } = sourceInfo;
  registerProject(projectId, cwd);
  watchContextDir(sourceDir, project, sourceName, projectId, sourceType);
  // Deliberately embeds even if `reconcilingSources.has(sourceDir)` — i.e. even
  // while a bulk reconcile is mid-flight over this same source. embedSingleFile
  // re-reads the file from disk at call time (it doesn't consume a pre-fetched
  // snapshot), and this call only fires after the PostToolUse edit that
  // triggered it has already landed on disk. So whichever of {this call,
  // reconcile's own per-file embed for this exact path} runs LAST simply
  // upserts whatever is currently on disk — last-write-wins, not
  // stale-overwrites-fresh. Skipping here to avoid a hypothetical race would
  // risk the opposite, real failure mode: silently dropping an edit that
  // reconcile's already-computed plan (a snapshot taken before this edit)
  // doesn't know to re-check. See PR #67 review discussion.
  const result = await embedSingleFile(
    absFile,
    sourceDir,
    project,
    sourceName,
    projectId,
    sourceType
  );
  if (result.embedded) {
    invalidateCorpusCache(project);
    logInfo('Incremental re-embed', { file: result.id, project: project ?? 'default' });
  } else if (result.reason === 'deleted') {
    invalidateCorpusCache(project);
    logInfo('Context file deleted — rows removed', {
      file: result.id,
      project: project ?? 'default'
    });
  }
  sendJson(res, 200, { ok: true, ...result });
}

/**
 * POST /capture — write a context or doc file atomically + embed + update index.
 * Replaces Write+Edit tool calls in staging mode for lower UI noise.
 *
 * target: "context" (default) — structured frontmatter, category dirs, CONTEXT.md index
 * target: "doc" — free-form markdown, flat in docs/, DOCS.md index
 */
/**
 * Queue a capture request to prevent silent drops when daemon is busy.
 * Requests process sequentially without blocking other endpoints.
 */
async function handleCapture(
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<void> {
  if (captureQueue.length >= MAX_CAPTURE_QUEUE_SIZE) {
    sendJson(res, 503, {
      error: `capture queue full (${MAX_CAPTURE_QUEUE_SIZE} items) — daemon overloaded`
    });
    return;
  }

  captureQueue.push({ body, res });
  if (!processingCapture) {
    await processCaptureQueue();
  }
}

/**
 * Process capture queue sequentially. Each capture completes (including async
 * embedding) before the next starts, preventing resource contention.
 * Error handling ensures one bad request doesn't wedge the queue permanently.
 */
async function processCaptureQueue(): Promise<void> {
  if (processingCapture || captureQueue.length === 0) return;
  processingCapture = true;

  try {
    while (captureQueue.length > 0) {
      const item = captureQueue.shift();
      if (item) {
        try {
          await executeCaptureRequest(item.body, item.res);
        } catch (err) {
          // executeCaptureRequest should send error responses on its own paths,
          // but if it throws before responding, ensure we send one.
          logError('error', 'capture-queue', 'capture request failed', {
            message: err instanceof Error ? err.message : String(err)
          });
          try {
            sendJson(item.res, 500, {
              error: `capture failed: ${err instanceof Error ? err.message : 'unknown'}`
            });
          } catch {
            // Response already sent, ignore
          }
        }
      }
    }
  } finally {
    // Reset flag even if something above throws, so queue never wedges
    processingCapture = false;
  }
}

/**
 * Execute a single capture request (renamed from original handleCapture logic).
 */
async function executeCaptureRequest(
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<void> {
  const target = typeof body.target === 'string' ? body.target : 'context';
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const content = typeof body.body === 'string' ? body.body : '';
  const scope = typeof body.scope === 'string' ? body.scope : 'project';
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;

  // cwd required for project-scoped captures (need filesystem path for writing)
  if (scope === 'project' && !cwd) {
    sendJson(res, 400, { error: 'cwd is required for project-scoped capture' });
    return;
  }

  if (cwd && !isValidProjectDir(cwd)) {
    sendJson(res, 400, { error: `cwd is not an existing absolute directory: ${cwd}` });
    return;
  }

  // Lazy-register for hash→name reverse lookup
  if (cwd) {
    const id = project ? resolveProjectId(project) : projectHash(cwd);
    registerProject(id, cwd);
  }

  if (target === 'doc') {
    // Doc mode: free-form markdown, no frontmatter, flat directory
    if (!slug || !content) {
      sendJson(res, 400, { error: 'missing required fields for doc: slug, body' });
      return;
    }

    const docsDir = scope === 'user' ? expandHome('~/.contextus/docs') : path.join(cwd!, 'docs');
    const filename = `${slug}.md`;
    const absFile = path.join(docsDir, filename);

    try {
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(absFile, content, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError('error', 'capture', 'failed to write doc file', { file: absFile, message: msg });
      sendJson(res, 500, { error: `write failed: ${msg}` });
      return;
    }

    // Update DOCS.md index — upsert by relPath, same as the context path
    // below (see lib/capture/context-index.ts).
    const indexFile = path.join(docsDir, 'DOCS.md');
    const indexEntry = `- [${slug}](${filename}) — ${description || slug}`;
    try {
      if (fs.existsSync(indexFile)) {
        const existing = fs.readFileSync(indexFile, 'utf-8');
        fs.writeFileSync(indexFile, upsertIndexEntry(existing, filename, indexEntry));
      }
    } catch {
      // Non-fatal
    }

    logCapture(scope, filename, description || slug);
    logInfo('Doc captured', { scope, file: filename });

    sendJson(res, 200, {
      ok: true,
      file: absFile,
      relPath: filename,
      target: 'doc',
      embedded: 'pending',
      scope
    });

    // Embed async
    const projectId = project ?? (cwd ? projectHash(cwd) : '__user__');
    const source = scope === 'user' ? 'userDocs' : 'projectDocs';
    embedSingleFile(absFile, docsDir, project, source, projectId, 'doc')
      .then((result) => {
        if (result.embedded) invalidateCorpusCache(project);
        logInfo('Doc embedded', { file: filename, embedded: result.embedded });
      })
      .catch((err) => {
        logError('warn', 'capture', 'async doc embed failed (reconcile will retry)', {
          file: filename,
          message: err instanceof Error ? err.message : String(err)
        });
      });
    return;
  }

  // Context mode (default): structured frontmatter, category dirs
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === 'string')
    : [];

  if (!category || !slug || !description || !content) {
    sendJson(res, 400, { error: 'missing required fields: category, slug, description, body' });
    return;
  }

  // Build the frontmatter + body via gray-matter's own serializer, not hand-
  // interpolated template strings — matter.stringify runs scalars through a
  // real YAML dumper, which quotes anything that needs it (an embedded ": ",
  // a leading special char, etc.) by construction. A free-text `description`
  // containing a colon used to silently break plain-scalar YAML parsing at
  // embed time with no error in the /capture response itself — see
  // gotcha-capture-description-colon-breaks-yaml-frontmatter.md and
  // https://github.com/equiphealth/claude-contextus/issues/70.
  const metadata: Record<string, unknown> = { type: category };
  if (tags.length > 0) metadata.tags = tags;
  const fileContent = matter.stringify(`\n${content}\n`, { name: slug, description, metadata });

  // Defense in depth: re-parse what we just built before writing it anywhere.
  // Should never actually fail — matter.stringify's own output is self-
  // consistent — but if it somehow does, reject loudly now rather than write
  // a file that will fail silently at embed time (reconcile does not
  // reliably catch or retry this class of failure; see issue #70).
  try {
    matter(fileContent);
  } catch (err) {
    sendJson(res, 400, {
      ok: false,
      error: `generated frontmatter failed to parse as YAML: ${err instanceof Error ? err.message : String(err)}`
    });
    return;
  }

  // Resolve target path — folder names follow existing conventions
  const CATEGORY_DIRS: Record<string, string> = {
    decision: 'decisions',
    gotcha: 'gotchas',
    tradeoff: 'tradeoffs',
    question: 'questions',
    arch: 'arch',
    api: 'api',
    phase: 'phase',
    project: 'project',
    schema: 'schema',
    security: 'security',
    perf: 'perf',
    reference: 'reference',
    implementation: 'implementation'
  };
  const contextDir =
    scope === 'user' ? expandHome('~/.contextus/context') : path.join(cwd!, '.claude', 'context');
  const dirName = CATEGORY_DIRS[category] || category;
  const categoryDir = path.join(contextDir, dirName);
  const filename = `${category}-${slug}.md`;
  const absFile = path.join(categoryDir, filename);

  // Write the file
  try {
    fs.mkdirSync(categoryDir, { recursive: true });
    fs.writeFileSync(absFile, fileContent, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('error', 'capture', 'failed to write context file', { file: absFile, message: msg });
    sendJson(res, 500, { error: `write failed: ${msg}` });
    return;
  }

  // Update CONTEXT.md index — upsert by relPath (see lib/capture/context-index.ts
  // for why a blind append caused duplicate entries on re-capture).
  const indexFile = path.join(contextDir, 'CONTEXT.md');
  const relPath = `${dirName}/${filename}`;
  const indexEntry = `- [${slug}](${relPath}) — ${description}`;
  try {
    if (fs.existsSync(indexFile)) {
      const existing = fs.readFileSync(indexFile, 'utf-8');
      fs.writeFileSync(indexFile, upsertIndexEntry(existing, relPath, indexEntry));
    }
  } catch {
    // Non-fatal — file is written, index update is best-effort
  }

  // Log to captures audit trail (sync — fast)
  logCapture(scope, relPath, description);
  logInfo('Context captured', { scope, file: relPath });

  // Respond immediately — file is on disk, git can see it
  sendJson(res, 200, {
    ok: true,
    file: absFile,
    relPath,
    target: 'context',
    embedded: 'pending',
    scope
  });

  // Embed async (fire-and-forget) — reconcile catches failures
  const projectId = project ?? (cwd ? projectHash(cwd) : '__user__');
  const source = scope === 'user' ? 'userContext' : 'projectContext';
  embedSingleFile(absFile, contextDir, project, source, projectId, 'context')
    .then((result) => {
      if (result.embedded) invalidateCorpusCache(project);
      logInfo('Capture embedded', { file: relPath, embedded: result.embedded });
    })
    .catch((err) => {
      logError('warn', 'capture', 'async embed failed (reconcile will retry)', {
        file: relPath,
        message: err instanceof Error ? err.message : String(err)
      });
    });
}

/**
 * POST /delete — archive a context file: move it out of the corpus, drop its
 * embeddings, and remove its CONTEXT.md index entry. Never a hard delete —
 * the file lands in `.claude/context/.archive/` (flat, no category subdir,
 * matching /context-archive's existing documented layout) so a bad archive
 * is one `mv`/`git mv` away from being undone. Cleanup of `.archive/` itself
 * is left to the user (`rm -rf .claude/context/.archive`) — no auto-purge.
 *
 * `.archive/**` is excluded from every source's embed glob by default (see
 * lib/config.ts DEFAULTS.sources), so archived files never get swept back
 * into the corpus by a full `pnpm embed` rebuild.
 */
async function handleDelete(
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<void> {
  const relPathRaw = typeof body.relPath === 'string' ? body.relPath.trim() : '';
  const scope = typeof body.scope === 'string' ? body.scope : 'project';
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;

  if (!relPathRaw) {
    sendJson(res, 400, { ok: false, error: 'missing required field: relPath' });
    return;
  }
  if (scope === 'project' && !cwd) {
    sendJson(res, 400, { ok: false, error: 'cwd is required for project-scoped delete' });
    return;
  }
  if (cwd && !isValidProjectDir(cwd)) {
    sendJson(res, 400, { ok: false, error: `cwd is not an existing absolute directory: ${cwd}` });
    return;
  }

  const contextDir =
    scope === 'user' ? expandHome('~/.contextus/context') : path.join(cwd!, '.claude', 'context');

  // Resolve + contain: relPath must land inside contextDir. Blocks `../../etc/passwd`
  // style traversal — same guard embedSingleFile uses for the mirror-image write path.
  const absFile = path.resolve(contextDir, relPathRaw);
  const normDir = path.resolve(contextDir);
  if (!absFile.startsWith(normDir + path.sep)) {
    sendJson(res, 400, { ok: false, error: 'relPath escapes the context directory' });
    return;
  }
  if (!fs.existsSync(absFile)) {
    sendJson(res, 404, { ok: false, error: `file not found: ${relPathRaw}` });
    return;
  }

  // relPath as stored in the corpus (rows are keyed by path relative to contextDir,
  // forward-slashed — matches embedSingleFile/buildRows).
  const relPath = path.relative(normDir, absFile).replace(/\\/g, '/');

  // Archive is flattened (no category subdir), so two files that share a
  // basename — most commonly a slug reused after an earlier archive of the
  // same name — would otherwise silently overwrite each other. De-dupe with
  // a numeric suffix rather than clobbering history the user can't get back.
  const archiveDir = path.join(contextDir, '.archive');
  const archiveBase = path.basename(absFile);
  let archiveDest = path.join(archiveDir, archiveBase);
  if (fs.existsSync(archiveDest)) {
    const ext = path.extname(archiveBase);
    const stem = archiveBase.slice(0, archiveBase.length - ext.length);
    let n = 2;
    while (fs.existsSync(path.join(archiveDir, `${stem}-${n}${ext}`))) n++;
    archiveDest = path.join(archiveDir, `${stem}-${n}${ext}`);
  }
  const archivedRelPath = `.archive/${path.basename(archiveDest)}`;
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(absFile, archiveDest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError('error', 'delete', 'failed to archive file', { file: relPath, message: msg });
    sendJson(res, 500, { ok: false, error: `archive failed: ${msg}` });
    return;
  }

  // Remove from CONTEXT.md index — best-effort text munging, matches the append
  // format capture uses (`- [slug](relPath) — description`). Non-fatal: the file
  // move + embedding delete already succeeded, a stale index line just means a
  // dead link, not a broken corpus.
  let removedFromIndex = false;
  const indexFile = path.join(contextDir, 'CONTEXT.md');
  try {
    if (fs.existsSync(indexFile)) {
      const before = fs.readFileSync(indexFile, 'utf-8');
      const marker = `](${relPath})`;
      const lines = before.split('\n');
      const filtered = lines.filter((line) => !line.includes(marker));
      if (filtered.length !== lines.length) {
        fs.writeFileSync(indexFile, filtered.join('\n'));
        removedFromIndex = true;
      }
    }
  } catch (err) {
    logError('warn', 'delete', 'failed to update CONTEXT.md index (non-fatal)', {
      file: relPath,
      message: err instanceof Error ? err.message : String(err)
    });
  }

  // Drop embeddings. Check first so the response can report whether there was
  // anything to remove (a file that was never embedded — e.g. prefix/type
  // mismatch quarantine — archives fine but has nothing to delete here).
  const projectId = project ?? (cwd ? projectHash(cwd) : '__user__');
  let embeddingsRemoved = false;
  try {
    const hashes = await getContentHashes(project, undefined, projectId);
    embeddingsRemoved = hashes.has(relPath);
    if (embeddingsRemoved) {
      await deleteByFilename(relPath, project, projectId);
      invalidateCorpusCache(project);
    }
  } catch (err) {
    logError('error', 'delete', 'failed to delete embeddings', {
      file: relPath,
      message: err instanceof Error ? err.message : String(err)
    });
    // The file move and index-line removal above already happened and are
    // real, even though this reports ok:false — say so explicitly, both so
    // the caller doesn't assume "nothing happened" and retry against a path
    // that's now a guaranteed 404, and so it can still reconcile the archive
    // location by hand if the embedding cleanup never recovers.
    sendJson(res, 500, {
      ok: false,
      error: `file archived but embedding cleanup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      archived: archiveDest,
      archivedRelPath,
      removedFromIndex
    });
    return;
  }

  logCapture(scope, relPath, `archived → ${archivedRelPath}`);
  logInfo('Context archived', { file: relPath, removedFromIndex, embeddingsRemoved });

  sendJson(res, 200, {
    ok: true,
    archived: archiveDest,
    archivedRelPath,
    removedFromIndex,
    embeddingsRemoved
  });
}

/* ── Directory watcher — live deletion detection ────────────────────────────── */

/**
 * Active watchers keyed by context dir path. One watcher per project.
 * Started after a successful reconcile (which proves the dir exists and is
 * worth watching). Uses fs.watch with recursive:true (supported on macOS/Win).
 */
const activeWatchers = new Map<string, fs.FSWatcher>();

/**
 * Close every active fs.watch handle and forget them — TEST-ONLY. The real
 * daemon never calls this (a watcher is meant to live for the process's
 * whole lifetime; SIGINT/SIGTERM tear it down implicitly via process.exit).
 * Integration tests that hit a code path arming a watcher on an ephemeral
 * tmp dir (e.g. /notify → watchContextDir) MUST call this in their `after()`
 * — otherwise the open handle keeps node --test's event loop non-empty and
 * the process can hang waiting to exit naturally (found via GH issue #22:
 * this was the first test to ever successfully route through /notify to a
 * real source, since every prior /notify test either failed JSON parsing or
 * hit not_in_any_source before reaching watchContextDir).
 */
export function closeAllWatchers(): void {
  for (const watcher of activeWatchers.values()) watcher.close();
  activeWatchers.clear();
}

function watchContextDir(
  contextDir: string,
  project: string | undefined,
  source = 'projectContext',
  projectId = '',
  sourceType?: string
): void {
  if (activeWatchers.has(contextDir)) return;
  if (!fs.existsSync(contextDir)) return;

  try {
    const watcher = fs.watch(contextDir, { recursive: true }, (_eventType, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      // Handle both 'rename' (create/delete) and 'change' (in-place edit)
      const absPath = path.join(contextDir, filename);
      // Guard is checked LIVE against the current set every time an event
      // fires — not captured once at watcher-creation time. A watcher for a
      // user-scoped (shared) source dir is created once and then reused by
      // every project that touches it (activeWatchers is keyed by contextDir,
      // and this function returns early once one exists) — a key captured at
      // creation would go stale the moment a DIFFERENT project's bulk
      // reconcile is the one actually in flight over this same directory. Since
      // `contextDir` here is the exact same absolute path handleReconcile adds
      // to `reconcilingSources` for every task (project- or user-scoped), this
      // check is correct regardless of which project armed the watcher or
      // which project is currently reconciling it (GH issue #56 follow-up,
      // surfaced by code review on PR #67).
      if (reconcilingSources.has(contextDir)) return;
      // Only act on deletions — file gone from disk
      if (!fs.existsSync(absPath)) {
        const projectLabel = project ?? 'default';
        embedSingleFile(absPath, contextDir, project, source, projectId, sourceType)
          .then((result) => {
            if (result.reason === 'deleted') {
              invalidateCorpusCache(project);
              logInfo('Watcher: context file deleted', {
                file: result.id,
                project: projectLabel,
                source
              });
            }
          })
          .catch(() => {});
      } else {
        // File created or modified — re-embed it
        const projectLabel = project ?? 'default';
        embedSingleFile(absPath, contextDir, project, source, projectId, sourceType)
          .then((result) => {
            if (result.embedded) {
              invalidateCorpusCache(project);
              logInfo('Watcher: context file updated', {
                file: result.id,
                project: projectLabel,
                source
              });
              const scope =
                source === 'userContext' || source === 'userDocs'
                  ? 'user'
                  : `project:${projectLabel}`;
              logCapture(scope, result.id ?? filename, 'auto-captured via watcher');
            }
          })
          .catch(() => {});
      }
    });
    activeWatchers.set(contextDir, watcher);
    logInfo('Watching context dir', { dir: contextDir, project: project ?? 'default', source });
  } catch {
    // fs.watch can fail on unsupported filesystems — degrade silently
  }
}

/**
 * Absolute source directory paths with an in-flight background reconcile.
 * Prevents a re-fire (e.g. two session-starts in quick succession) from
 * stacking a second embed pass over the same corpus, and stops a source's
 * live fs.watch from double-embedding a file the bulk reconcile is already
 * about to (re-)embed. The reconcile itself is idempotent, so this is an
 * efficiency guard, not a correctness one.
 *
 * Keyed by the source's absolute directory path (the same value passed to
 * both `runReconcile` and `watchContextDir`), NOT by project identity. A
 * project label/name/hash can be represented multiple inconsistent ways
 * across calls (GH issue #56); a filesystem path canonicalizes for free via
 * path.resolve and — crucially — is the same value regardless of which
 * project's `/reconcile` call happens to be the one processing a *shared*
 * user-scoped source, so a watcher for a shared dir stays correct no matter
 * which project currently owns the in-flight reconcile over it.
 */
const reconcilingSources = new Set<string>();

/**
 * TEST-ONLY escape hatch. `handleReconcile`'s non-check path never resolves
 * without a real embedding provider (modelLoaded gate), which CI doesn't have
 * — see reconcile-multi-source.test.ts's file-level doc comment for why every
 * other test in that file sticks to `check: true`. Seeding this set directly
 * lets a test simulate "a bulk reconcile is already in flight over path X"
 * and then assert the busy-guard (`/reconcile`, non-check) and the watcher
 * guard (`watchContextDir`'s fs.watch callback) both respect it — without
 * needing a live model. Never used by the real daemon.
 */
export function __test_seedReconcilingSource(sourcePath: string): void {
  reconcilingSources.add(sourcePath);
}
export function __test_clearReconcilingSources(): void {
  reconcilingSources.clear();
}

/**
 * POST /reconcile — bring a project's corpus in line with its `.claude/context/`.
 *
 * Two modes:
 *   - `check: true` → cheap dry-run. Computes the plan and returns the corpus
 *     `state` (missing/stale/fresh/empty) WITHOUT embedding. session-start uses
 *     this to decide whether a cold/stale corpus needs reconciling.
 *   - default       → fires the reconcile in the BACKGROUND and responds
 *     immediately with `{ state: 'started' }` (or 'busy'/'noop'). Background so
 *     embedding N files + a model load never blocks the session-start window
 *     (first-run-onboarding); the first prompt or two may miss context while it
 *     warms, which is the existing graceful-degradation behavior.
 */
async function handleReconcile(
  body: Record<string, unknown>,
  res: http.ServerResponse
): Promise<void> {
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;
  const projectLabel = project ?? 'default';
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
  if (!cwd) return sendJson(res, 400, { error: 'cwd is required for reconcile' });
  if (!isValidProjectDir(cwd)) {
    return sendJson(res, 400, { error: `cwd is not an existing absolute directory: ${cwd}` });
  }
  // Normalize project identifier (accepts hash, name, or path) to canonical hash
  const projectId = project ? resolveProjectId(project) : projectHash(cwd);
  registerProject(projectId, cwd);
  const check = body.check === true;

  // Dry-run: report the corpus state without touching anything. Iterates every
  // enabled source (not just projectContext) — this is what session-start's
  // checkCorpus() uses to decide whether to fire a real reconcile at all, and a
  // real reconcile is also what arms the live fs.watch per source
  // (watchContextDir) for the rest of the daemon's life. Under-checking here used
  // to mean a project whose ONLY drift was in docs/ never got its watcher armed
  // that session, even though the non-check path below already supported it
  // (GH issue #22).
  if (check) {
    const cfg = loadProjectConfig(projectId, cwd);
    const sources = cfg.sources as Record<
      string,
      {
        scope: 'project' | 'user';
        path: string;
        type?: string;
        enabled?: boolean;
        exclude?: string[];
      }
    >;
    const exists = await tableExists(project);

    const statePriority: Record<ReturnType<typeof planReconcile>['state'], number> = {
      missing: 3,
      stale: 2,
      fresh: 1,
      empty: 0
    };
    let aggState: ReturnType<typeof planReconcile>['state'] = 'empty';
    let newCount = 0;
    let changedCount = 0;
    let removeCount = 0;
    const quarantined: string[] = [];

    for (const [sourceName, s] of Object.entries(sources)) {
      if (s.enabled === false) continue;
      const sourcePath = s.scope === 'project' ? path.join(cwd, s.path) : expandHome(s.path);
      const sourceProjectId = s.scope === 'project' ? projectId : '';

      const allContexts = await loadContexts(sourcePath, s.exclude);
      // Quarantine prefix/type-mismatch files — MUST match runReconcile (both call
      // the shared quarantineMismatches(), so this can only drift out of sync with
      // itself in one place now), or they'd show as perpetual "new" here (the
      // "re-embedding 1 forever" phantom). Report the count so session-start can
      // surface "N file(s) can't embed — fix them".
      const { contexts, quarantined: mismatches } = quarantineMismatches(allContexts, s.type);
      // Scope hash lookup to THIS source + projectId — MUST match runReconcile,
      // or another source's rows look like orphans (or this source's look unembedded).
      const hashes = await getContentHashes(project, sourceName, sourceProjectId || undefined);
      const diskFiles: DiskFile[] = contexts.map((c) => ({
        id: c.id,
        absPath: c.absPath,
        content: c.content
      }));
      const plan = planReconcile(diskFiles, hashes, exists);

      newCount += plan.toEmbedNew.length;
      changedCount += plan.toEmbedChanged.length;
      removeCount += plan.toRemove.length;
      // Qualify with sourceName: two sources could otherwise report the same
      // relPath (e.g. a stray `gotcha-x.md` under both .claude/context/ and docs/).
      quarantined.push(...mismatches.map((p) => `${sourceName}/${p}`));
      if (statePriority[plan.state] > statePriority[aggState]) aggState = plan.state;
    }

    return sendJson(res, 200, {
      state: aggState,
      newCount,
      changedCount,
      removeCount,
      quarantined, // relPaths of files that can't embed (bad prefix/type) — surface these
      // Piggybacked here rather than a separate endpoint: `cfg` above is
      // already the correctly MERGED (3-tier) config, and session-start-hook.js
      // already calls this exact check every session — no extra round trip
      // needed for the SessionStart-triggered transcript-mining gate (GH issue
      // #39) to read a project's real opt-in setting instead of a raw,
      // un-merged one (same bug class /notify's determineSource() had).
      transcriptMining: cfg.transcriptMining
    });
  }

  // Reconcile all enabled sources from the 3-tier MERGED config — not the raw
  // plugin manifest, so a project's .claude/contextus.jsonc overrides (custom
  // exclude, disabled source, custom path) are honored the same way the manual
  // `pnpm embed` CLI already honors them (GH issue #22). Computed BEFORE the
  // busy-guard below so the guard can check by source path (see
  // reconcilingSources's doc comment for why that's the right key — GH #56).
  const cfg = loadProjectConfig(projectId, cwd);
  const sources = cfg.sources as Record<
    string,
    {
      scope: 'project' | 'user';
      path: string;
      type?: string;
      enabled?: boolean;
      exclude?: string[];
    }
  >;

  const reconcileTasks = Object.entries(sources)
    .filter(([, s]) => s.enabled !== false)
    .map(([sourceName, s]) => {
      const sourcePath = s.scope === 'project' ? path.join(cwd, s.path) : expandHome(s.path);

      const pid = s.scope === 'project' ? projectId : '';
      const proj = s.scope === 'project' ? project : undefined;

      return {
        sourceName,
        sourcePath,
        pid,
        proj,
        scope: s.scope,
        exclude: s.exclude,
        sourceType: s.type
      };
    });

  if (reconcileTasks.some((t) => reconcilingSources.has(t.sourcePath))) {
    return sendJson(res, 200, { state: 'busy' });
  }
  if (!modelLoaded) {
    // Can't embed without the model; the caller can retry once /health is warm.
    return sendJson(res, 200, { state: 'cold', reason: 'model_not_loaded' });
  }

  reconcileTasks.forEach((t) => reconcilingSources.add(t.sourcePath));
  // Respond immediately; the embed runs detached from the request lifecycle.
  sendJson(res, 200, { state: 'started' });

  Promise.all(
    reconcileTasks.map((t) =>
      runReconcile(t.sourcePath, t.proj, t.pid, t.sourceName, t.exclude, t.sourceType)
    )
  )
    .then(async (results) => {
      const totalEmbedded = results.reduce((sum, r) => sum + r.embedded, 0);
      const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);

      if (totalEmbedded > 0 || totalRemoved > 0) {
        invalidateCorpusCache(project);
        const sourceStats = reconcileTasks.reduce(
          (acc, t, i) => {
            acc[t.sourceName] = { embedded: results[i].embedded, removed: results[i].removed };
            return acc;
          },
          {} as Record<string, { embedded: number; removed: number }>
        );

        logInfo('Reconcile complete', {
          project: projectLabel,
          ...sourceStats
        });
      }

      // Watch all source directories.
      reconcileTasks.forEach((t) => {
        watchContextDir(t.sourcePath, t.proj, t.sourceName, t.pid, t.sourceType);
      });
    })
    .catch((err) =>
      logError('error', 'daemon', 'Reconcile failed', {
        project: projectLabel,
        message: err instanceof Error ? err.message : String(err)
      })
    )
    .finally(() => reconcileTasks.forEach((t) => reconcilingSources.delete(t.sourcePath)));
}

/**
 * The daemon's HTTP request handler, extracted so tests can build their own
 * `http.createServer(requestHandler)` on an ephemeral port — real requests,
 * real response shapes, without booting the actual daemon (model warmup,
 * PID files, the fixed port). See tests/integration/capture-endpoint.test.ts.
 */
export function requestHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
    return handleHealth(req, res);
  }

  // GET /novelty?project=foo — recently-injected pattern names for the awareness
  // hook's novelty signal. Cheap in-memory read; no body.
  if (method === 'GET' && url.startsWith('/novelty')) {
    const project = new URL(url, BASE_URL()).searchParams.get('project') ?? 'default';
    return sendJson(res, 200, { project, recent: noveltyFor(project) });
  }

  // GET /introspect?project=foo — live config + corpus stats (Self-doc Layer 1).
  // Feeds /context-status so the dashboard shows real numbers, not a mock.
  if (method === 'GET' && url.startsWith('/introspect')) {
    const projectParam = new URL(url, BASE_URL()).searchParams.get('project') ?? undefined;
    // Normalize project identifier (accepts hash, name, or path) to canonical hash
    const project = projectParam ? resolveProjectId(projectParam) : undefined;
    buildIntrospection({
      version: DAEMON_VERSION,
      uptimeSeconds: process.uptime(),
      modelLoaded,
      project
    })
      .then((info) => sendJson(res, 200, info))
      .catch((err) => {
        logError('error', 'daemon', '/introspect failed', {
          message: err instanceof Error ? err.message : String(err)
        });
        sendJson(res, 500, { error: 'introspect failed' });
      });
    return;
  }

  // POST /search — raw corpus search without injection floor (for /context-search skill)
  if (method === 'POST' && url === '/search') {
    readJsonBody(req)
      .then(async (body) => {
        const query = typeof body.query === 'string' ? body.query : '';
        const project = typeof body.project === 'string' && body.project ? body.project : undefined;
        const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;
        const limit = typeof body.limit === 'number' ? body.limit : 10;

        // Normalize project identifier
        const projectId = project ? resolveProjectId(project) : cwd ? projectHash(cwd) : undefined;
        const projectScope = cwd
          ? resolveProjectScope(cwd)
          : projectId
            ? [projectId, '__user__']
            : undefined;

        if (!query.trim()) {
          return sendJson(res, 200, { results: [] });
        }

        if (!modelLoaded) {
          return sendJson(res, 503, { error: 'Model not loaded yet' });
        }

        if (!(await tableExists(projectId))) {
          return sendJson(res, 200, { results: [] });
        }

        try {
          const vec = await embedQuery(query);
          const raw = await search(vec, limit * 4, undefined, projectId, projectScope);

          // Return raw results with scores, no floor filtering
          const results = raw.slice(0, limit).map((r) => ({
            id: r.id,
            filename: r.filename,
            description: (r as any).description || '',
            type: r.type,
            source: r.source,
            similarity: Number(r.similarity.toFixed(4))
          }));

          sendJson(res, 200, { results, query, project: projectId });
        } catch (err) {
          logError('error', 'daemon', '/search failed', {
            message: err instanceof Error ? err.message : String(err)
          });
          sendJson(res, 500, { error: 'Search failed' });
        }
      })
      .catch((err) => {
        logError('error', 'daemon', '/search handler failed', {
          message: err instanceof Error ? err.message : String(err)
        });
        sendJson(res, 500, { error: 'Search request malformed' });
      });
    return;
  }

  // /capture is never hook-triggered — nothing calls it expecting `{continue:true}`
  // semantics, since there's no prompt it could be blocking. Give it its own catch
  // so it always gets an honest error response, even for failures upstream of
  // handleCapture's own queue/try-catch (e.g. a malformed JSON body).
  if (method === 'POST' && url === '/capture') {
    readJsonBody(req)
      .then((body) => handleCapture(body, res))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logError('error', 'daemon', 'capture request failed', { message });
        sendJson(res, 400, { ok: false, error: `capture failed: ${message}` });
      });
    return;
  }

  // Same reasoning as /capture above — /delete is never hook-triggered, so it
  // gets its own catch and an honest {ok:false, error} instead of {continue:true}.
  if (method === 'POST' && url === '/delete') {
    readJsonBody(req)
      .then((body) => handleDelete(body, res))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logError('error', 'daemon', 'delete request failed', { message });
        sendJson(res, 400, { ok: false, error: `delete failed: ${message}` });
      });
    return;
  }

  if (method === 'POST' && (url === '/query' || url === '/notify' || url === '/reconcile')) {
    readJsonBody(req)
      .then((body) => {
        if (url === '/query') return handleQuery(body, res);
        if (url === '/notify') return handleNotify(body, res);
        return handleReconcile(body, res);
      })
      .catch((err) => {
        logError('error', 'daemon', `${url} handler failed`, {
          message: err instanceof Error ? err.message : String(err)
        });
        // Never break the prompt — degrade to continue.
        sendJson(res, 200, { continue: true });
      });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(requestHandler);

/** Write PID + port files so ensureDaemonRunning can find/health-check us. */
function writeRuntimeFiles(): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(PID_PATH, String(process.pid));
  fs.writeFileSync(PORT_PATH, String(actualPort));
}

function cleanupRuntimeFiles(): void {
  try {
    if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
  } catch {
    /* best-effort */
  }
}

const WARMUP_MAX_RETRIES = 5;
const WARMUP_BASE_DELAY_MS = 10_000; // 10s, 20s, 40s, 80s, 160s
let warmupRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Pre-warm the expansion model (fire-and-forget). Ollama unloads idle models,
 * so qwen2.5:3b takes ~9.5s cold vs 443ms warm. Sending a trivial generate
 * request loads the model into memory before the first real expansion fires.
 */
function prewarmExpansion(): void {
  const cfg = loadConfig();
  if (cfg.expansion.mode === 'off') return;
  if (cfg.expansion.provider !== 'ollama') return;

  const endpoint = cfg.providers?.ollama?.endpoint || 'http://localhost:11434';
  const model = cfg.expansion.model;

  fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
    signal: AbortSignal.timeout(15_000)
  })
    .then(() => logInfo('Expansion model pre-warmed', { model }))
    .catch(() => {
      // Best-effort — if it fails, expansion will just use fallback or time out
    });
}

function attemptWarmup(attempt = 0): void {
  const cfg = loadConfig();
  warmup()
    .then(() => {
      modelLoaded = true;
      warmupError = null;
      if (attempt > 0) {
        logInfo('Model warm (recovered)', {
          model:
            cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model,
          afterAttempt: attempt + 1
        });
      } else {
        logInfo('Model warm', {
          model:
            cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model
        });
      }
      prewarmExpansion();
    })
    .catch((err) => {
      warmupError = err instanceof Error ? err.message : String(err);
      logError('error', 'embedder', 'Model warmup failed', {
        message: warmupError,
        attempt: attempt + 1,
        maxRetries: WARMUP_MAX_RETRIES
      });
      if (attempt < WARMUP_MAX_RETRIES) {
        const delay = WARMUP_BASE_DELAY_MS * Math.pow(2, attempt);
        logInfo('Warmup retry scheduled', { nextAttempt: attempt + 2, delayMs: delay });
        warmupRetryTimer = setTimeout(() => attemptWarmup(attempt + 1), delay);
      } else {
        logError('warn', 'embedder', 'Warmup retries exhausted — restart daemon or provider', {});
      }
    });
}

async function startDaemon(): Promise<void> {
  // Rotate stale logs before any writes happen (synchronous, cheap for fresh logs).
  rotateLogsOnStartup();

  // Bind first so a second daemon racing for the port fails fast (EADDRINUSE)
  // instead of double-loading the model.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      // Another daemon already owns the port — defer to it and exit quietly.
      logInfo('Port in use — another daemon is running, exiting', { port: PREFERRED_PORT });
      process.exit(0);
    }
    logError('error', 'daemon', 'Server error', { message: err.message });
    process.exit(1);
  });

  server.listen(PREFERRED_PORT, '127.0.0.1', () => {
    actualPort = (server.address() as any).port;
    writeRuntimeFiles();
    const cfg = loadConfig();
    logInfo('Daemon started', {
      pid: process.pid,
      port: actualPort,
      preferredPort: PREFERRED_PORT,
      provider: cfg.embedding.provider
    });
    // Warm the model AFTER the socket is listening so /health is reachable and
    // reports modelLoaded:false while loading (session-start polls for true).
    attemptWarmup();
    // Start eval loop (polls queue, drains when non-empty)
    startEvalLoop();
    // Initialize usage evaluation state if config enables it (gate-mismatch fix:
    // stop hook enqueues when usageEvaluation.enabled, eval-loop drains when
    // calibrationState.evaluateUsage=true; this bridges the two).
    if (cfg.usageEvaluation?.enabled) {
      const state = readCalibrationState();
      if (!state.evaluateUsage) {
        const mode = cfg.usageEvaluation.mode ?? 'continuous';
        startCalibration({ mode });
        logInfo('Usage evaluation initialized', { mode });
      }
    }
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
    stopEvalLoop();
    logInfo('Daemon stopping', { signal: sig, uptime: `${Math.round(process.uptime())}s` });
    cleanupRuntimeFiles();
    server.close(() => process.exit(0));
    // Force-exit if close hangs on a keep-alive socket.
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

// Only boot the real daemon when this file is the executed entrypoint
// (`node daemon/server.ts`) — not when it's imported as a module (e.g. tests
// importing `requestHandler`), which would otherwise bind the real port and
// warm the real model as an import side effect.
if (import.meta.url === `file://${process.argv[1]}`) {
  startDaemon().catch((err) => {
    logError('error', 'daemon', 'Failed to start', {
      message: err instanceof Error ? err.message : String(err)
    });
    process.exit(1);
  });
}
