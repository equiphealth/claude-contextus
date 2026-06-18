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
 * Endpoints:
 *   GET  /health          → { status, uptime, modelLoaded, lancedbConnected, embeddingModel }
 *   GET  /introspect      → live config + corpus stats (Self-doc Layer 1)
 *   POST /query  {project, prompt}        → { continue, hookSpecificOutput?: { additionalContext } }
 *   POST /notify {project, file, cwd?}    → { ok, embedded, id? }
 *   POST /reconcile {project, cwd, check?}→ { state, started? } | { state, embedded, removed }
 *
 * The pipeline on /query is the spine: embedQuery → vector search → rerank →
 * floor → format. Floor-dropped chunks are logged with scores (v2 governance
 * groundwork). No-inject is a first-class, logged success.
 */

import http from 'http';
import path from 'path';
import fs from 'fs';
import { loadConfig, loadProjectConfig, expandHome } from '../lib/config.js';
import { warmup, embedQuery } from '../lib/embedding/embedder.js';
import { search, tableExists, readTableMeta, incrementHits } from '../lib/storage/lance-client.js';
import { rerank } from '../lib/retrieval/reranker.js';
import { dedupe, collapseByFile } from '../lib/retrieval/dedup.js';
import { applyFloor } from '../lib/retrieval/floor.js';
import {
  formatInjection,
  renderFooterInstruction,
  estimateTokens
} from '../lib/retrieval/inject-format.js';
import { expandQuery, shouldExpand } from '../lib/retrieval/expand.js';
import { keywordSearch, loadCorpusForKeyword } from '../lib/retrieval/keyword.js';
import { fuseRRF, hybridKeywordSearch } from '../lib/retrieval/hybrid.js';
import {
  buildRetrievalMissNotice,
  isNearMiss,
  extractNearTopics
} from '../lib/retrieval/miss-notice.js';
import { recordInjection, noveltyFor } from '../lib/capture/novelty.js';
import { embedSingleFile } from '../lib/embedding/embed-file.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { planReconcile, type DiskFile } from '../lib/storage/reconcile.js';
import { loadContexts, findPrefixTypeMismatches } from '../lib/embedding/context-loader.js';
import { getContentHashes } from '../lib/storage/lance-client.js';
import { recordLastInjection } from '../lib/session-state.js';
import { readState as readCalibrationState } from '../lib/calibration/calibration-state.js';
import { buildIntrospection } from '../lib/introspect.js';
import {
  logRetrieval,
  logNoInject,
  logParanoid,
  logError,
  logInfo,
  promptHash,
  type DroppedChunkLog
} from '../lib/logger.js';
import { rotateLogsOnStartup } from '../lib/log-rotation.js';

const PORT = 37800;
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Daemon/protocol version reported by /introspect (keep in sync with plugin.json). */
const DAEMON_VERSION = '0.1.0';
const RUNTIME_DIR = expandHome('~/.contextus/runtime');
const PID_PATH = path.join(RUNTIME_DIR, 'daemon.pid');
const PORT_PATH = path.join(RUNTIME_DIR, 'daemon.port');

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
  const url = new URL(req.url ?? '/', BASE_URL);
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
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;
  // cwd = the project repo root, needed for the git-committed tier-3 config override.
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : undefined;

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
  if (!(await tableExists(project))) {
    logInfo('No corpus for project — skipping', { project: projectLabel });
    return sendJson(res, 200, { continue: true });
  }

  // Validate query-time embedding space matches build-time (DESIGN.md model
  // consistency). Both the model id AND the dimensions must agree — a mismatch on
  // either means the query vector and the stored vectors live in different spaces,
  // so similarities are meaningless. Fail fast + degrade rather than inject noise.
  // Project-aware: floor/topK/etc. resolve through the 3-tier merge (global →
  // machine-local → git-committed), so each project calibrates independently.
  const cfg = loadProjectConfig(project, cwd);
  const meta = readTableMeta(project);
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

  // --- Embedding + vector search (with hybrid fusion + keyword fallback + auto-recovery) ---
  // When hybrid='always': run keyword search in parallel with vector search, then
  // fuse via RRF. When embedding genuinely fails (provider down), degrade to
  // keyword-only (with auto-recovery trigger) so users get SOME context rather than complete silence.
  let raw: Awaited<ReturnType<typeof search>>;
  let usedKeywordFallback = false;
  try {
    const CHUNK_FANOUT = 4;
    const fetchLimit = cfg.retrieval.topK * CHUNK_FANOUT;

    if (cfg.retrieval.hybrid === 'always') {
      // Hybrid mode: run vector + keyword in parallel, fuse with RRF
      const [vec, corpus] = await Promise.all([embedQuery(prompt), loadCorpusForKeyword(project)]);
      const [semanticResults, keywordResults] = await Promise.all([
        search(vec, fetchLimit, undefined, project),
        Promise.resolve(hybridKeywordSearch(corpus, prompt, cfg.retrieval.topK))
      ]);
      if (keywordResults.length > 0) {
        raw = fuseRRF(semanticResults, keywordResults, fetchLimit);
      } else {
        raw = semanticResults;
      }
    } else {
      // Pure semantic search
      const vec = await embedQuery(prompt);
      raw = await search(vec, fetchLimit, undefined, project);
    }
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
    const corpus = await loadCorpusForKeyword(project);
    if (corpus.length === 0) {
      return sendJson(res, 200, { continue: true });
    }
    const keywordResults = keywordSearch(corpus, prompt, cfg.retrieval.topK);
    if (keywordResults.length === 0) {
      logInfo('Keyword fallback: no matches', { project: projectLabel });
      return sendJson(res, 200, { continue: true });
    }
    raw = keywordResults;
    usedKeywordFallback = true;
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
  if (
    !usedKeywordFallback &&
    shouldExpand(cfg.expansion.mode, initialBest, cfg.expansion.expansionThreshold)
  ) {
    const expanded = await expandQuery(prompt, cfg.expansion, cfg.providers);
    if (expanded.variants.length > 0) {
      stats.expansionFired++;
      // Variants use a smaller fetch limit — the union provides breadth,
      // so each individual variant doesn't need the full CHUNK_FANOUT over-fetch.
      const variantLimit = cfg.retrieval.topK * 2;
      const variantSearches = await Promise.all(
        expanded.variants.map(async (variant) => {
          const vVec = await embedQuery(variant);
          return search(vVec, variantLimit, undefined, project);
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

  const ranked = rerank(raw);
  // Collapse chunks to one best representative per file FIRST (a file's sections
  // aren't competing matches), then trim to topK files, then fold near-duplicate
  // files before the floor. Order: rerank → collapse → topK → dedupe → floor.
  const byFile = collapseByFile(ranked).slice(0, cfg.retrieval.topK);
  const { kept: deduped } = dedupe(byFile);
  const { kept, dropped, bestScore, noInject } = applyFloor(deduped, cfg.retrieval.injectionFloor);

  const floorDropped: DroppedChunkLog[] = dropped.map((d) => ({
    pattern: d.filename || d.id,
    similarity: Number(d.similarity.toFixed(4))
  }));

  if (noInject) {
    logNoInject({
      project: projectLabel,
      promptHash: hash,
      bestScore: Number(bestScore.toFixed(4)),
      promptTokens: estimateTokens(prompt),
      latencyMs: Date.now() - started,
      floorDropped
    });
    if (cfg.logging.paranoid) {
      logParanoid({
        project: projectLabel,
        promptHash: hash,
        prompt,
        injection: '',
        retrieved: [],
        similarityScores: [Number(bestScore.toFixed(4))],
        latencyMs: Date.now() - started
      });
    }
    // Retrieval-miss signal: when the best score is above noise (>0.25) but below
    // the floor, this was a "near miss" — the corpus had something related but not
    // strong enough. Surface a targeted capture prompt so Claude proposes context
    // that would fill the gap, or asks the user about it.
    if (isNearMiss(bestScore, floorDropped.length)) {
      const nearTopics = extractNearTopics(floorDropped);
      const missNotice = buildRetrievalMissNotice(
        bestScore,
        cfg.retrieval.injectionFloor,
        nearTopics
      );
      return sendJson(res, 200, {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: missNotice
        }
      });
    }
    return sendJson(res, 200, { continue: true });
  }

  const { block, included, tokens } = formatInjection(kept, cfg.retrieval.maxTokens, cwd);
  const injectedNames = included.map((r) => r.filename || r.id);

  // Learn from this injection (best-effort, off the response path):
  //  - bump hit_count so the re-ranker favors patterns that actually surface
  //  - remember the set so /novelty can tell the awareness hook what we have
  incrementHits(
    included.map((r) => r.id),
    project
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
    floorDropped
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

  // Append a TRUTHFUL provenance-footer instruction scoped to exactly these files
  // (renderFooterInstruction). Co-located with the real injected set so Claude
  // reports ground truth instead of fabricating a footer (the awareness hook can't
  // do this — it doesn't know what was injected; instructing it to induced
  // hallucination, observed 2026-06-15). Gated by retrieval.provenanceFooter
  // (per-project): some users want only the answer, not the retrieval receipt. The
  // `propose:` capture footer is separate + always-on (it's how patterns get saved).
  const fallbackNotice = usedKeywordFallback
    ? '\n\n[contextus notice] Results above are from keyword fallback (embedding provider was unreachable). Relevance may be lower than normal semantic search.'
    : '';
  const footer = cfg.retrieval.provenanceFooter ? renderFooterInstruction(included) : '';
  sendJson(res, 200, {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: block + fallbackNotice + footer
    }
  });
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
  const project = typeof body.project === 'string' && body.project ? body.project : undefined;
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd();
  if (!file) return sendJson(res, 200, { ok: true, embedded: false, reason: 'no_file' });

  const absFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  const contextDir = path.join(cwd, '.claude', 'context');
  const result = await embedSingleFile(absFile, contextDir, project);
  if (result.embedded) {
    logInfo('Incremental re-embed', { file: result.id, project: project ?? 'default' });
  }
  sendJson(res, 200, { ok: true, ...result });
}

/**
 * Projects with an in-flight background reconcile. Prevents a re-fire (e.g. two
 * session-starts in quick succession) from stacking a second embed pass over the
 * same corpus. The reconcile itself is idempotent, so this is an efficiency
 * guard, not a correctness one.
 */
const reconcilingProjects = new Set<string>();

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
  const cwd = typeof body.cwd === 'string' && body.cwd ? body.cwd : process.cwd();
  const check = body.check === true;
  const contextDir = path.join(cwd, '.claude', 'context');

  // Dry-run: report the corpus state without touching anything.
  if (check) {
    const allContexts = await loadContexts(contextDir);
    const exists = await tableExists(project);
    // Quarantine prefix/type-mismatch files — MUST match runReconcile, or they'd
    // show as perpetual "new" here (the "re-embedding 1 forever" phantom). Report
    // the count so session-start can surface "N file(s) can't embed — fix them".
    const quarantined = findPrefixTypeMismatches(allContexts).map((m) => m.relPath);
    const badPaths = new Set(quarantined);
    const contexts = allContexts.filter((c) => !badPaths.has(c.relPath));
    // Scope to projectContext — MUST match runReconcile (which only manages the
    // context source). Unfiltered, doc/user-pack rows (which refresh on a full
    // embed, not via reconcile) look like orphans of the context dir → bogus
    // "stale, removeCount=N" and a nonsense "re-embedding 0" session-start line.
    const hashes = await getContentHashes(project, 'projectContext');
    const diskFiles: DiskFile[] = contexts.map((c) => ({
      id: c.id,
      absPath: c.absPath,
      content: c.content
    }));
    const plan = planReconcile(diskFiles, hashes, exists);
    return sendJson(res, 200, {
      state: plan.state,
      newCount: plan.toEmbedNew.length,
      changedCount: plan.toEmbedChanged.length,
      removeCount: plan.toRemove.length,
      quarantined // relPaths of files that can't embed (bad prefix/type) — surface these
    });
  }

  if (reconcilingProjects.has(projectLabel)) {
    return sendJson(res, 200, { state: 'busy' });
  }
  if (!modelLoaded) {
    // Can't embed without the model; the caller can retry once /health is warm.
    return sendJson(res, 200, { state: 'cold', reason: 'model_not_loaded' });
  }

  reconcilingProjects.add(projectLabel);
  // Respond immediately; the embed runs detached from the request lifecycle.
  sendJson(res, 200, { state: 'started' });
  runReconcile(contextDir, project)
    .then((r) => {
      if (r.embedded > 0 || r.removed > 0) {
        logInfo('Reconcile complete', {
          project: projectLabel,
          state: r.state,
          embedded: r.embedded,
          removed: r.removed
        });
      }
    })
    .catch((err) =>
      logError('error', 'daemon', 'Reconcile failed', {
        project: projectLabel,
        message: err instanceof Error ? err.message : String(err)
      })
    )
    .finally(() => reconcilingProjects.delete(projectLabel));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
    return handleHealth(req, res);
  }

  // GET /novelty?project=foo — recently-injected pattern names for the awareness
  // hook's novelty signal. Cheap in-memory read; no body.
  if (method === 'GET' && url.startsWith('/novelty')) {
    const project = new URL(url, BASE_URL).searchParams.get('project') ?? 'default';
    return sendJson(res, 200, { project, recent: noveltyFor(project) });
  }

  // GET /introspect?project=foo — live config + corpus stats (Self-doc Layer 1).
  // Feeds /context-status so the dashboard shows real numbers, not a mock.
  if (method === 'GET' && url.startsWith('/introspect')) {
    const project = new URL(url, BASE_URL).searchParams.get('project') ?? undefined;
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
});

/** Write PID + port files so ensureDaemonRunning can find/health-check us. */
function writeRuntimeFiles(): void {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.writeFileSync(PID_PATH, String(process.pid));
  fs.writeFileSync(PORT_PATH, String(PORT));
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
      logInfo('Port in use — another daemon is running, exiting', { port: PORT });
      process.exit(0);
    }
    logError('error', 'daemon', 'Server error', { message: err.message });
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    writeRuntimeFiles();
    const cfg = loadConfig();
    logInfo('Daemon started', {
      pid: process.pid,
      port: PORT,
      provider: cfg.embedding.provider
    });
    // Warm the model AFTER the socket is listening so /health is reachable and
    // reports modelLoaded:false while loading (session-start polls for true).
    attemptWarmup();
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
    logInfo('Daemon stopping', { signal: sig, uptime: `${Math.round(process.uptime())}s` });
    cleanupRuntimeFiles();
    server.close(() => process.exit(0));
    // Force-exit if close hangs on a keep-alive socket.
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

startDaemon().catch((err) => {
  logError('error', 'daemon', 'Failed to start', {
    message: err instanceof Error ? err.message : String(err)
  });
  process.exit(1);
});
