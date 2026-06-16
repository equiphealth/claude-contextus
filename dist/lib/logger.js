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
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { expandHome } from './config.js';
const LOG_DIR = expandHome('~/.contextus/logs');
const USAGE_PATH = path.join(LOG_DIR, 'usage.jsonl');
const DAEMON_LOG_PATH = path.join(LOG_DIR, 'daemon.log');
const ERRORS_PATH = path.join(LOG_DIR, 'errors.jsonl');
let _dirReady = false;
function ensureDir() {
    if (_dirReady)
        return;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        _dirReady = true;
    }
    catch {
        /* best-effort: if we can't make the dir, writes below no-op */
    }
}
function appendSafe(file, line) {
    ensureDir();
    try {
        fs.appendFileSync(file, line);
    }
    catch {
        /* logging must never break retrieval */
    }
}
/** First 8 hex chars of SHA-256 — privacy-preserving prompt identity (LOGGING.md). */
export function promptHash(prompt) {
    return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 8);
}
/** `[2026-06-14 14:23:42.156] LEVEL message (k=v, …)` for daemon.log. */
function humanLine(level, message, kv) {
    const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
    const pairs = kv
        ? Object.entries(kv)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')
        : '';
    const suffix = pairs ? ` (${pairs})` : '';
    return `[${ts}] ${level} ${message}${suffix}\n`;
}
/** Log a successful retrieval (≥1 chunk injected) to both sinks. */
export function logRetrieval(e) {
    const record = {
        type: 'retrieval',
        timestamp: new Date().toISOString(),
        project: e.project,
        prompt_hash: e.promptHash,
        retrieved: e.retrieved,
        tokens_injected: e.tokensInjected,
        latency_ms: e.latencyMs,
        similarity_scores: e.similarityScores,
        floor_dropped: e.floorDropped,
    };
    appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
    appendSafe(DAEMON_LOG_PATH, humanLine('INFO', `Retrieved ${e.retrieved.length} patterns`, {
        scores: e.similarityScores.map((s) => s.toFixed(2)).join('/') || '—',
        latency: `${e.latencyMs}ms`,
        dropped: e.floorDropped.length,
        project: e.project,
    }));
}
/** Log a no-inject (below-floor) outcome to both sinks. */
export function logNoInject(e) {
    const record = {
        type: 'retrieval',
        timestamp: new Date().toISOString(),
        project: e.project,
        prompt_hash: e.promptHash,
        retrieved: [],
        tokens_injected: 0,
        latency_ms: e.latencyMs,
        reason: 'below_floor',
        best_match_score: e.bestScore,
        floor_dropped: e.floorDropped,
    };
    appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
    appendSafe(DAEMON_LOG_PATH, humanLine('INFO', 'No retrieval', {
        reason: 'below_floor',
        best: e.bestScore.toFixed(4),
        project: e.project,
    }));
}
/**
 * Log a calibration_eval event (LOGGING.md). This is the quality metric that
 * matters — whether injected patterns were actually USED — as opposed to the
 * tokens-saved efficiency number on retrieval events (opus-metrics-critique).
 */
export function logCalibrationEval(e) {
    const record = {
        type: 'calibration_eval',
        timestamp: new Date().toISOString(),
        project: e.project,
        prompt_hash: e.promptHash,
        retrieved: e.retrieved,
        evaluations: e.evaluations,
        weighted_score: Number(e.weightedScore.toFixed(4)),
        evaluation_latency_ms: e.evaluationLatencyMs,
    };
    appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
    appendSafe(DAEMON_LOG_PATH, humanLine('INFO', 'Calibration eval', {
        score: e.weightedScore.toFixed(2),
        rated: e.evaluations.length,
        of: e.retrieved.length,
        project: e.project,
    }));
}
/** Log a structured error/warning to errors.jsonl + daemon.log. */
export function logError(level, component, message, context) {
    const record = {
        level,
        timestamp: new Date().toISOString(),
        component,
        error: message,
        context: context ?? {},
    };
    appendSafe(ERRORS_PATH, JSON.stringify(record) + '\n');
    appendSafe(DAEMON_LOG_PATH, humanLine(level.toUpperCase(), message, { component, ...context }));
}
/** Plain human-readable daemon lifecycle line (start/stop/notify). */
export function logInfo(message, kv) {
    appendSafe(DAEMON_LOG_PATH, humanLine('INFO', message, kv));
}
//# sourceMappingURL=logger.js.map