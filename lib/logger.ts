/**
 * Logger — dual-format event logging (DESIGN.md / LOGGING.md).
 *
 * Two sinks, written together on every event:
 *   - usage.jsonl   — one JSON object per line, machine-readable analytics
 *   - daemon.log    — `[ts] [LEVEL] message (k=v, …)`, human-readable tail
 *   - errors.jsonl  — structured errors/warnings
 *
 * Everything lands under ~/.contextus/logs/. Writes are best-effort appends:
 * logging must NEVER throw into the retrieval hot path, so all sink writes are
 * wrapped and swallow their own errors.
 *
 * Phase-2 rejection logging (groundwork for v2 removal/governance, per
 * IMPLEMENTATION_ESTIMATE): every chunk the floor drops is recorded with its
 * score in the retrieval event's `floor_dropped` array. Cheap now, can't
 * backfill later.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { expandHome } from './config.js';

const LOG_DIR = expandHome('~/.contextus/logs');
const USAGE_PATH = path.join(LOG_DIR, 'usage.jsonl');
const DAEMON_LOG_PATH = path.join(LOG_DIR, 'daemon.log');
const ERRORS_PATH = path.join(LOG_DIR, 'errors.jsonl');
const PARANOID_PATH = path.join(LOG_DIR, 'paranoid.jsonl');

let _dirReady = false;
function ensureDir(): void {
  if (_dirReady) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _dirReady = true;
  } catch {
    /* best-effort: if we can't make the dir, writes below no-op */
  }
}

function appendSafe(file: string, line: string): void {
  ensureDir();
  try {
    fs.appendFileSync(file, line);
  } catch {
    /* logging must never break retrieval */
  }
}

/** First 8 hex chars of SHA-256 — privacy-preserving prompt identity (LOGGING.md). */
export function promptHash(prompt: string): string {
  return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 8);
}

/** `[2026-06-14 14:23:42.156] LEVEL message (k=v, …)` for daemon.log. */
function formatValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((item, i) => `[${i + 1}] ${item}`).join(' | ');
  return String(v);
}

function humanLine(level: string, message: string, kv?: Record<string, unknown>): string {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const pairs = kv
    ? Object.entries(kv)
        .map(([k, v]) => `${k}=${formatValue(v)}`)
        .join(', ')
    : '';
  const suffix = pairs ? ` (${pairs})` : '';
  return `[${ts}] ${level} ${message}${suffix}\n`;
}

/** A floor-dropped chunk as logged (filename + score). */
export interface DroppedChunkLog {
  pattern: string;
  similarity: number;
}

/** A retrieval that injected one or more chunks. */
export interface RetrievalLog {
  project: string;
  promptHash: string;
  /** whitespace-collapsed first 120 chars of the prompt (watch display + grouping) */
  promptPreview: string;
  retrieved: string[];
  similarityScores: number[];
  tokensInjected: number;
  /** estimated token count of the user's prompt (for overhead % calculation) */
  promptTokens: number;
  latencyMs: number;
  /** every chunk the floor dropped, with its score (v2 governance evidence) */
  floorDropped: DroppedChunkLog[];
  /** best initial (pre-expansion) score, when expansion fired; else null */
  initialBest: number | null;
  /** true when expansion fired on a weak query and retrieval then injected */
  rescued: boolean | null;
  /** injected filename → variant index that surfaced it (-1 = original query) */
  variantAttribution: Record<string, number>;
}

/** Collapse whitespace and truncate — prompt preview safe for single-line logs. */
export function promptPreview(prompt: string, maxLen = 120): string {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/** Log a successful retrieval (≥1 chunk injected) to both sinks. */
export function logRetrieval(e: RetrievalLog): void {
  const record = {
    type: 'retrieval',
    timestamp: new Date().toISOString(),
    project: e.project,
    prompt_hash: e.promptHash,
    prompt_preview: e.promptPreview,
    retrieved: e.retrieved,
    tokens_injected: e.tokensInjected,
    prompt_tokens: e.promptTokens,
    latency_ms: e.latencyMs,
    similarity_scores: e.similarityScores,
    floor_dropped: e.floorDropped,
    initial_best: e.initialBest,
    rescued: e.rescued,
    variant_attribution: e.variantAttribution
  };
  appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
  const kv: Record<string, unknown> = {
    phash: e.promptHash,
    prompt: `"${e.promptPreview.replace(/"/g, "'")}"`,
    scores: e.similarityScores.map((s) => s.toFixed(2)).join('/') || '—',
    latency: `${e.latencyMs}ms`,
    dropped: e.floorDropped.length,
    project: e.project
  };
  if (e.initialBest !== null) kv.initialBest = e.initialBest.toFixed(4);
  if (e.rescued !== null) kv.rescued = e.rescued;
  const top = topVariant(e.variantAttribution, e.retrieved);
  if (top !== null) kv.topVariant = top;
  appendSafe(DAEMON_LOG_PATH, humanLine('INFO', `Retrieved ${e.retrieved.length} patterns`, kv));
}

/** Variant index behind the most injected rows (original query = -1); null when unknown. */
export function topVariant(
  attribution: Record<string, number>,
  retrieved: string[]
): number | null {
  const counts = new Map<number, number>();
  for (const f of retrieved) {
    const v = attribution[f];
    if (v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

/** A retrieval where nothing cleared the floor — a first-class logged outcome. */
export interface NoInjectLog {
  project: string;
  promptHash: string;
  /** whitespace-collapsed first 120 chars of the prompt (watch display + grouping) */
  promptPreview: string;
  bestScore: number;
  /** estimated token count of the user's prompt */
  promptTokens: number;
  latencyMs: number;
  /** below-floor chunks still logged as governance evidence */
  floorDropped: DroppedChunkLog[];
  /** false when expansion fired but retrieval still missed (failed rescue); else null */
  rescued: boolean | null;
}

/** Log a no-inject (below-floor) outcome to both sinks. */
export function logNoInject(e: NoInjectLog): void {
  const record = {
    type: 'retrieval',
    timestamp: new Date().toISOString(),
    project: e.project,
    prompt_hash: e.promptHash,
    prompt_preview: e.promptPreview,
    retrieved: [],
    tokens_injected: 0,
    prompt_tokens: e.promptTokens,
    latency_ms: e.latencyMs,
    reason: 'below_floor',
    best_match_score: e.bestScore,
    floor_dropped: e.floorDropped,
    rescued: e.rescued
  };
  appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
  const kv: Record<string, unknown> = {
    reason: 'below_floor',
    best: e.bestScore.toFixed(4),
    phash: e.promptHash,
    prompt: `"${e.promptPreview.replace(/"/g, "'")}"`,
    project: e.project
  };
  if (e.rescued !== null) kv.rescued = e.rescued;
  appendSafe(DAEMON_LOG_PATH, humanLine('INFO', 'No retrieval', kv));
}

/** A single pattern's calibration rating (LOGGING.md calibration_eval event). */
export interface EvalRatingLog {
  pattern: string;
  rating: string;
}

/** A completed calibration evaluation (the honest quality signal). */
export interface CalibrationEvalLog {
  project: string;
  promptHash: string;
  retrieved: string[];
  evaluations: EvalRatingLog[];
  weightedScore: number;
  evaluationLatencyMs: number;
}

/**
 * Log a calibration_eval event (LOGGING.md). This is the quality metric that
 * matters — whether injected patterns were actually USED — as opposed to the
 * tokens-saved efficiency number on retrieval events (opus-metrics-critique).
 */
export function logCalibrationEval(e: CalibrationEvalLog): void {
  const record = {
    type: 'calibration_eval',
    timestamp: new Date().toISOString(),
    project: e.project,
    prompt_hash: e.promptHash,
    retrieved: e.retrieved,
    evaluations: e.evaluations,
    weighted_score: Number(e.weightedScore.toFixed(4)),
    evaluation_latency_ms: e.evaluationLatencyMs
  };
  appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
  appendSafe(
    DAEMON_LOG_PATH,
    humanLine('INFO', 'Calibration eval', {
      score: e.weightedScore.toFixed(2),
      rated: e.evaluations.length,
      of: e.retrieved.length,
      phash: e.promptHash,
      project: e.project
    })
  );
}

/** Log a structured error/warning to errors.jsonl + daemon.log. */
export function logError(
  level: 'error' | 'warn',
  component: string,
  message: string,
  context?: Record<string, unknown>
): void {
  const record = {
    level,
    timestamp: new Date().toISOString(),
    component,
    error: message,
    context: context ?? {}
  };
  appendSafe(ERRORS_PATH, JSON.stringify(record) + '\n');
  appendSafe(DAEMON_LOG_PATH, humanLine(level.toUpperCase(), message, { component, ...context }));
}

/** Plain human-readable daemon lifecycle line (start/stop/notify). */
export function logInfo(message: string, kv?: Record<string, unknown>): void {
  appendSafe(DAEMON_LOG_PATH, humanLine('INFO', message, kv));
}

/** Usage signal: self-reported context usage from the provenance footer. */
export interface UsageSignalLog {
  project: string;
  promptHash: string;
  injected: string[];
  used: string[];
  usageRate: number;
}

/** Log a usage_signal event — the model's self-report of what context it used. */
export function logUsageSignal(e: UsageSignalLog): void {
  const record = {
    type: 'usage_signal',
    timestamp: new Date().toISOString(),
    project: e.project,
    prompt_hash: e.promptHash,
    injected: e.injected,
    used: e.used,
    usage_rate: Number(e.usageRate.toFixed(4))
  };
  appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
  appendSafe(
    DAEMON_LOG_PATH,
    humanLine('INFO', 'Usage signal', {
      used: `${e.used.length}/${e.injected.length}`,
      rate: `${(e.usageRate * 100).toFixed(0)}%`,
      phash: e.promptHash,
      project: e.project
    })
  );
}

/** Full round-trip log: prompt text + injection payload. Privacy-sensitive. */
export interface ParanoidLog {
  project: string;
  promptHash: string;
  prompt: string;
  injection: string;
  retrieved: string[];
  similarityScores: number[];
  latencyMs: number;
}

/**
 * Log the full prompt + injection payload to paranoid.jsonl. Only called when
 * logging.paranoid is true. This captures everything sent to the LLM so you
 * can debug retrieval quality without guessing what was in/out.
 */
export function logParanoid(e: ParanoidLog): void {
  const record = {
    type: 'paranoid',
    timestamp: new Date().toISOString(),
    project: e.project,
    prompt_hash: e.promptHash,
    prompt: e.prompt,
    injection: e.injection,
    retrieved: e.retrieved,
    similarity_scores: e.similarityScores,
    latency_ms: e.latencyMs
  };
  appendSafe(PARANOID_PATH, JSON.stringify(record) + '\n');
}
