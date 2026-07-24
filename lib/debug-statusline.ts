/**
 * Debug statusline — per-session snapshot of the last /query outcome, written
 * by the daemon so an opt-in statusline script (scripts/install-debug-statusline.sh)
 * can render a verbose "what did contextus just do" line without the daemon
 * having to know anything about bash/statuslines.
 *
 * Two data sources combined here:
 *   1. The IMMEDIATE outcome of the query that just ran (score, floor, tokens,
 *      latency, expansion/hybrid/capacity status) — passed in by the caller.
 *   2. A ROLLING "% useful" average from this project's usage-ratings.jsonl —
 *      computed here, since usage evaluation (daemon/eval-loop.ts) runs in a
 *      BACKGROUND loop and rates the PREVIOUS turn's injection some seconds
 *      after the response completes. There is no synchronous "was THIS
 *      injection useful" signal — by the time the statusline for the CURRENT
 *      turn renders, the eval for the injection a turn or two back has usually
 *      landed, so a rolling average over the last few ratings is both more
 *      available and less noisy than trying to match a single promptHash.
 *
 * Deliberately kept out of daemon/server.ts: this writes to disk on every
 * query and reads a ratings file back, which has no business slowing down or
 * complicating the retrieval hot path — it's a side channel, tested in
 * isolation, called fire-and-forget after the response is already sent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from './config.js';

const RUNTIME_DIR = expandHome('~/.contextus/runtime');

/** One rated injection, as written by lib/calibration/eval-worker-core.ts. */
export interface UsageRating {
  weightedScore: number;
}

/** Everything the statusline needs to render one line about the last query. */
export interface LastInjectionDebug {
  timestamp: number;
  project: string;
  injected: boolean;
  count: number;
  candidates: number;
  bestScore: number;
  floor: number;
  topK: number;
  tokensInjected: number;
  latencyMs: number;
  expansion: 'off' | 'fired' | 'skipped';
  hybrid: 'off' | 'adaptive-skip' | 'adaptive-fired' | 'always' | 'keyword-fallback';
  capacityTier: 'none' | 'reduced' | 'minimal' | 'disabled';
  sources: Record<string, number>;
  /** Rolling avg weightedScore over the last `recentUsefulSamples` ratings, as 0-100, null if no data yet */
  recentUsefulPct: number | null;
  recentUsefulSamples: number;
}

/**
 * Read the last `window` ratings for a project's usage-ratings.jsonl.
 * Best-effort: returns [] if the file doesn't exist or usage evaluation has
 * never run for this project (e.g. usageEvaluation.enabled: false, or no
 * campaign has completed a single eval yet).
 */
export function readRecentUsageRatings(projectId: string, window = 10): UsageRating[] {
  const ratingsPath = path.join(expandHome('~/.contextus/data'), projectId, 'usage-ratings.jsonl');
  let raw: string;
  try {
    raw = fs.readFileSync(ratingsPath, 'utf-8');
  } catch {
    return [];
  }
  const lines = raw.split('\n').filter((l) => l.trim());
  const tail = lines.slice(-window);
  const out: UsageRating[] = [];
  for (const line of tail) {
    try {
      const parsed = JSON.parse(line) as { weightedScore?: unknown };
      if (typeof parsed.weightedScore === 'number')
        out.push({ weightedScore: parsed.weightedScore });
    } catch {
      /* skip a torn/partial line — best-effort */
    }
  }
  return out;
}

/**
 * Average weightedScore (0-1 scale) over the given ratings, as a 0-100 int.
 * Pure — no I/O — so it's cheap to unit test independent of the filesystem.
 */
export function computeRecentUsefulPct(ratings: UsageRating[]): {
  pct: number | null;
  samples: number;
} {
  if (ratings.length === 0) return { pct: null, samples: 0 };
  const sum = ratings.reduce((acc, r) => acc + r.weightedScore, 0);
  return { pct: Math.round((sum / ratings.length) * 100), samples: ratings.length };
}

/**
 * Assemble + write the per-session debug snapshot. Best-effort: swallows all
 * errors, since this must never surface as a failure on the query path (it's
 * always called after the real response has already been sent).
 */
export function writeLastInjectionDebug(
  sessionId: string | undefined,
  projectId: string | undefined,
  data: Omit<LastInjectionDebug, 'timestamp' | 'recentUsefulPct' | 'recentUsefulSamples'>
): void {
  if (!sessionId) return; // no session id (e.g. direct API caller) — nothing to key the file on
  try {
    const ratings = projectId ? readRecentUsageRatings(projectId) : [];
    const { pct, samples } = computeRecentUsefulPct(ratings);
    const snapshot: LastInjectionDebug = {
      ...data,
      timestamp: Math.floor(Date.now() / 1000),
      recentUsefulPct: pct,
      recentUsefulSamples: samples
    };
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RUNTIME_DIR, `${sessionId}.last-injection.json`),
      JSON.stringify(snapshot)
    );
  } catch {
    /* best-effort — never let statusline debug writes affect the daemon */
  }
}
