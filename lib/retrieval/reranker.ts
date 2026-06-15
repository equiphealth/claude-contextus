/**
 * Re-ranker — lightweight post-retrieval scoring (DESIGN.md §"Re-ranking").
 *
 * No LLM calls, no cross-encoders, <5ms. Multiplies the raw vector similarity by
 * four cheap factors and re-sorts:
 *
 *   finalScore = similarity
 *              × sourceWeight(metadata.source)
 *              × typeBoost(metadata.type)
 *              × freshnessDecay(updated_at)
 *              × hitCountBoost(hit_count)
 *
 * `typeBoost` reads `metadata.type` and `sourceWeight` reads the stored `source`
 * column (multi-source ingest, Phase 6): curated `.claude/context/` outranks
 * noisier `docs/`. Unknown types/sources fall back to neutral 1.0 rather than
 * dropping the row.
 *
 * IMPORTANT: re-ranking changes ORDER, not the floor decision. The injection
 * floor (lib/floor.ts) gates on RAW similarity, not finalScore — a typeBoost
 * must never lift an irrelevant chunk over the floor. Keep the two separate.
 */

import type { SearchResult } from '../storage/lance-client.js';

/** Source priority (DESIGN.md §"Multi-Source Architecture"). Neutral until the
 *  `source` column exists; kept here so multi-source ingest only flips data. */
export const SOURCE_WEIGHTS: Record<string, number> = {
  projectContext: 1.0,
  projectDocs: 0.9,
  userContext: 0.8,
  parentContext: 0.7,
  userDocs: 0.7,
  custom: 0.7,
  // legacy source labels (pre-rename)
  projectMemory: 1.0,
  parentMemory: 0.7,
  userMemory: 0.8,
};

/** Type priority (DESIGN.md §"Re-ranking" typeBoosts). Actionable patterns rank
 *  highest. Covers both the legacy memory vocabulary and the new category set. */
export const TYPE_BOOSTS: Record<string, number> = {
  // legacy memory types (DESIGN.md table). `feedback` is banned (reclassified on
  // migration) — no boost entry; an actionable convention lands as decision/gotcha.
  reference: 1.0,
  decision: 0.9,
  project: 0.8,
  // new category vocabulary (CATEGORIES_AND_TAGS.md) — actionable > descriptive
  gotcha: 1.2,
  tradeoff: 1.1,
  api: 1.05,
  schema: 1.0,
  security: 1.1,
  perf: 1.05,
  arch: 0.95,
  phase: 0.8,
  implementation: 1.0,
};

/** A re-ranked result carries its final composite score alongside the original. */
export interface RankedResult extends SearchResult {
  /** similarity × all re-rank factors; used only for ORDER, never for the floor */
  finalScore: number;
}

/** Look up a multiplicative weight, defaulting to neutral 1.0 for unknowns. */
function weight(table: Record<string, number>, key: string | undefined): number {
  if (!key) return 1.0;
  return table[key] ?? 1.0;
}

/**
 * Freshness decay — gently favors recently-embedded rows. Half-life ~180 days, so
 * a year-old pattern still scores ~0.75 (we never want freshness to dominate
 * relevance). Returns 1.0 for missing/invalid timestamps.
 */
export function freshnessDecay(updatedAt: string | undefined, now = Date.now()): number {
  if (!updatedAt) return 1.0;
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return 1.0;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  const HALF_LIFE_DAYS = 180;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/**
 * Hit-count boost — logarithmic, diminishing returns, caps around 1.3 (DESIGN.md
 * §"Re-ranking"). A frequently-retrieved pattern gets a mild nudge without
 * letting popularity swamp relevance (DESIGN.md "Bias warning").
 */
export function hitCountBoost(count: number | undefined): number {
  return 1 + Math.log10(1 + (count || 0)) * 0.15;
}

/**
 * Re-rank search results in place-safe fashion (returns a new sorted array).
 * `now` is injectable for deterministic tests.
 */
export function rerank(results: SearchResult[], now = Date.now()): RankedResult[] {
  return results
    .map((r) => {
      const finalScore =
        r.similarity *
        weight(SOURCE_WEIGHTS, r.source) *
        weight(TYPE_BOOSTS, r.type) *
        freshnessDecay(r.updated_at, now) *
        hitCountBoost(r.hit_count);
      return { ...r, finalScore };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}
