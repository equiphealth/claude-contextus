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
import { loadConfig, expandHome } from '../lib/config.js';
import { warmup, embedQuery } from '../lib/embedding/embedder.js';
import { search, tableExists, readTableMeta, incrementHits } from '../lib/storage/lance-client.js';
import { rerank } from '../lib/retrieval/reranker.js';
import { dedupe, collapseByFile } from '../lib/retrieval/dedup.js';
import { applyFloor } from '../lib/retrieval/floor.js';
import { formatInjection } from '../lib/retrieval/inject-format.js';
import { recordInjection, noveltyFor } from '../lib/capture/novelty.js';
import { embedSingleFile } from '../lib/embedding/embed-file.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { planReconcile, type DiskFile } from '../lib/storage/reconcile.js';
import { loadContexts } from '../lib/embedding/context-loader.js';
import { getContentHashes } from '../lib/storage/lance-client.js';
import { recordLastInjection } from '../lib/session-state.js';
import { readState as readCalibrationState } from '../lib/calibration/calibration-state.js';
import { buildIntrospection } from '../lib/introspect.js';
import {
  logRetrieval,
  logNoInject,
  logError,
  logInfo,
  promptHash,
  type DroppedChunkLog,
} from '../lib/logger.js';

const PORT = 37800;
const BASE_URL = `http://127.0.0.1:${PORT}`;
/** Daemon/protocol version reported by /introspect (keep in sync with plugin.json). */
const DAEMON_VERSION = '0.1.0';
const RUNTIME_DIR = expandHome('~/.contextus/runtime');
const PID_PATH = path.join(RUNTIME_DIR, 'daemon.pid');
const PORT_PATH = path.join(RUNTIME_DIR, 'daemon.port');

/** Set true once the embedding model has warm-loaded; /health gates on it. */
let modelLoaded = false;

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

/** GET /health — liveness + readiness (modelLoaded is what session-start polls). */
function handleHealth(res: http.ServerResponse): void {
  const cfg = loadConfig();
  sendJson(res, 200, {
    status: 'ok',
    uptime: process.uptime(),
    modelLoaded,
    lancedbConnected: true, // file-mode: connection is lazy + always available
    embeddingModel:
      cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model,
    provider: cfg.embedding.provider,
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
  const cfg = loadConfig();
  const meta = readTableMeta(project);
  const activeModel =
    cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model;
  if (meta && meta.embeddingModel !== activeModel) {
    logError('error', 'daemon', 'Embedding model mismatch (corpus vs daemon)', {
      project: projectLabel,
      corpus: meta.embeddingModel,
      daemon: activeModel,
      fix: 're-embed the corpus with the active model (pnpm run embed) or restore the build-time model',
    });
    // Degrade gracefully — a mismatched space yields garbage similarities.
    return sendJson(res, 200, { continue: true });
  }
  if (meta && meta.dimensions !== cfg.embedding.dimensions) {
    logError('error', 'daemon', 'Embedding dimension mismatch (corpus vs daemon)', {
      project: projectLabel,
      corpus: meta.dimensions,
      daemon: cfg.embedding.dimensions,
      fix: 're-embed the corpus (pnpm run embed) so stored vectors match config.embedding.dimensions',
    });
    return sendJson(res, 200, { continue: true });
  }

  const vec = await embedQuery(prompt);
  // Over-fetch: files are now chunked, so a topK of chunks may all belong to a few
  // files. Pull a wider net (topK × CHUNK_FANOUT) so enough DISTINCT files survive
  // the collapse-by-file step below to fill topK.
  const CHUNK_FANOUT = 4;
  const raw = await search(vec, cfg.retrieval.topK * CHUNK_FANOUT, undefined, project);
  const ranked = rerank(raw);
  // Collapse chunks to one best representative per file FIRST (a file's sections
  // aren't competing matches), then trim to topK files, then fold near-duplicate
  // files before the floor. Order: rerank → collapse → topK → dedupe → floor.
  const byFile = collapseByFile(ranked).slice(0, cfg.retrieval.topK);
  const { kept: deduped } = dedupe(byFile);
  const { kept, dropped, bestScore, noInject } = applyFloor(deduped, cfg.retrieval.injectionFloor);

  const floorDropped: DroppedChunkLog[] = dropped.map((d) => ({
    pattern: d.filename || d.id,
    similarity: Number(d.similarity.toFixed(4)),
  }));

  if (noInject) {
    logNoInject({
      project: projectLabel,
      promptHash: hash,
      bestScore: Number(bestScore.toFixed(4)),
      latencyMs: Date.now() - started,
      floorDropped,
    });
    return sendJson(res, 200, { continue: true });
  }

  const { block, included, tokens } = formatInjection(kept, cfg.retrieval.maxTokens);
  const injectedNames = included.map((r) => r.filename || r.id);

  // Learn from this injection (best-effort, off the response path):
  //  - bump hit_count so the re-ranker favors patterns that actually surface
  //  - remember the set so /novelty can tell the awareness hook what we have
  incrementHits(
    included.map((r) => r.id),
    project
  ).catch((err) =>
    logError('warn', 'daemon', 'hit-count update failed', {
      message: err instanceof Error ? err.message : String(err),
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
        snippet: r.document.replace(/\s+/g, ' ').slice(0, 160),
      })),
      timestamp: new Date().toISOString(),
    });
  }

  logRetrieval({
    project: projectLabel,
    promptHash: hash,
    retrieved: injectedNames,
    similarityScores: included.map((r) => Number(r.similarity.toFixed(4))),
    tokensInjected: tokens,
    latencyMs: Date.now() - started,
    floorDropped,
  });

  sendJson(res, 200, {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: block,
    },
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
    const contexts = await loadContexts(contextDir);
    const exists = await tableExists(project);
    const hashes = await getContentHashes(project);
    const diskFiles: DiskFile[] = contexts.map((c) => ({
      id: c.id,
      absPath: c.absPath,
      content: c.content,
    }));
    const plan = planReconcile(diskFiles, hashes, exists);
    return sendJson(res, 200, {
      state: plan.state,
      newCount: plan.toEmbedNew.length,
      changedCount: plan.toEmbedChanged.length,
      removeCount: plan.toRemove.length,
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
          removed: r.removed,
        });
      }
    })
    .catch((err) =>
      logError('error', 'daemon', 'Reconcile failed', {
        project: projectLabel,
        message: err instanceof Error ? err.message : String(err),
      })
    )
    .finally(() => reconcilingProjects.delete(projectLabel));
}

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (method === 'GET' && url === '/health') {
    return handleHealth(res);
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
      project,
    })
      .then((info) => sendJson(res, 200, info))
      .catch((err) => {
        logError('error', 'daemon', '/introspect failed', {
          message: err instanceof Error ? err.message : String(err),
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
          message: err instanceof Error ? err.message : String(err),
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

async function startDaemon(): Promise<void> {
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
      provider: cfg.embedding.provider,
    });
    // Warm the model AFTER the socket is listening so /health is reachable and
    // reports modelLoaded:false while loading (session-start polls for true).
    warmup()
      .then(() => {
        modelLoaded = true;
        logInfo('Model warm', {
          model:
            cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model,
        });
      })
      .catch((err) => {
        logError('error', 'embedder', 'Model warmup failed', {
          message: err instanceof Error ? err.message : String(err),
        });
        // Leave modelLoaded:false — health stays not-ready, queries degrade.
      });
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logInfo('Daemon stopping', { signal: sig, uptime: `${Math.round(process.uptime())}s` });
    cleanupRuntimeFiles();
    server.close(() => process.exit(0));
    // Force-exit if close hangs on a keep-alive socket.
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

startDaemon().catch((err) => {
  logError('error', 'daemon', 'Failed to start', {
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
