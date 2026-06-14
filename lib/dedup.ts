/**
 * Dedup — drop near-duplicate chunks from a retrieval set before injection.
 *
 * Vector search can return several rows that say nearly the same thing (e.g. a
 * decision file and its phase-log echo). Injecting both wastes the token budget
 * and dilutes attention. v1 dedup is CHEAP and deterministic: cosine similarity
 * on the already-computed embeddings, no second LLM pass (that's the v2 CAE).
 *
 * Greedy keep-first: walk the (re-ranked, so best-first) list; keep a chunk
 * unless it's ≥ threshold similar to one already kept. Order is preserved.
 *
 * NOTE: this is distinct from the injection floor. The floor asks "relevant at
 * all?"; dedup asks "do we already have this?". A chunk can clear the floor and
 * still be dropped as a duplicate of a higher-ranked sibling.
 */

import type { RankedResult } from './reranker.js';

/** Cosine similarity of two L2-normalized vectors (= dot product). Defensive on
 *  length/empties so a malformed row never throws into the hot path. */
export function cosine(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Default near-duplicate threshold. Deliberately high — only fold chunks that
 *  are genuinely saying the same thing, not merely on-topic together. */
export const DEFAULT_DEDUP_THRESHOLD = 0.95;

/** Outcome of dedup: what we keep, and which duplicates we folded (+ who they
 *  duplicated, for logging). */
export interface DedupResult {
  kept: RankedResult[];
  dropped: Array<{ chunk: RankedResult; duplicateOf: string; similarity: number }>;
}

/**
 * Greedily remove near-duplicates from a re-ranked list. Vectors come straight
 * off the search rows. A row without a usable vector can never match (cosine
 * returns 0), so it's always kept — dedup never silently drops on missing data.
 */
export function dedupe(ranked: RankedResult[], threshold = DEFAULT_DEDUP_THRESHOLD): DedupResult {
  const kept: RankedResult[] = [];
  const dropped: DedupResult['dropped'] = [];

  for (const cand of ranked) {
    let dupeOf: RankedResult | null = null;
    let dupeSim = 0;
    for (const k of kept) {
      const sim = cosine(cand.vector, k.vector);
      if (sim >= threshold && sim > dupeSim) {
        dupeOf = k;
        dupeSim = sim;
      }
    }
    if (dupeOf) {
      dropped.push({
        chunk: cand,
        duplicateOf: dupeOf.filename || dupeOf.id,
        similarity: Number(dupeSim.toFixed(4)),
      });
    } else {
      kept.push(cand);
    }
  }

  return { kept, dropped };
}
