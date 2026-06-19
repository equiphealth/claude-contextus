/**
 * Injection floor — "don't inject just to inject" (DESIGN.md §"Injection Floor").
 *
 * Vector search always returns a top-K; there is no natural zero. The floor
 * restores the self-gating keyword search gave for free: below it, nothing is
 * injected and that is a first-class SUCCESS, not a failure.
 *
 * Gate on RAW similarity, NOT the re-ranked finalScore. The floor answers "is
 * this chunk relevant at all?" — a typeBoost must never push a 0.2-similarity
 * chunk over the line. Re-ranking decides ORDER among chunks that already clear
 * the floor.
 *
 * ⚠ PHASE-5 CALIBRATION (the load-bearing caveat): the floor is model-dependent
 * and the deployed value is UNVALIDATED. Phase-1 measurement (see the
 * floor-calibration-signals memory + BUILD_LOG) found ollama-nomic puts CORRECT
 * top hits at 0.72–0.84 (cosine similarity from L2²: 1 - _distance/2) with
 * noise at ~0.5. The floor-replay harness sets the real number from real prompts;
 * this default exists only to make the spine demonstrably inject.
 */

import type { RankedResult } from './reranker.js';

/** Outcome of applying the floor: what survived, what didn't, and why. */
export interface FloorResult {
  /** chunks at/above the floor, still in re-ranked order */
  kept: RankedResult[];
  /** chunks below the floor — logged for v2 removal/governance evidence */
  dropped: RankedResult[];
  /** best raw similarity seen (for the no-inject log line), 0 if no results */
  bestScore: number;
  /** true when nothing cleared the floor — a logged, first-class outcome */
  noInject: boolean;
}

/**
 * Partition re-ranked results by the injection floor on RAW similarity.
 * Preserves input order within each partition (input is already re-ranked).
 */
export function applyFloor(ranked: RankedResult[], floor: number): FloorResult {
  const kept: RankedResult[] = [];
  const dropped: RankedResult[] = [];
  for (const r of ranked) {
    if (r.similarity >= floor) kept.push(r);
    else dropped.push(r);
  }
  return {
    kept,
    dropped,
    bestScore: ranked.length > 0 ? Math.max(...ranked.map((r) => r.similarity)) : 0,
    noInject: kept.length === 0
  };
}
