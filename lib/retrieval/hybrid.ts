/**
 * Hybrid search — semantic + keyword fusion via Reciprocal Rank Fusion (RRF).
 *
 * Always-on: runs keyword search in parallel with vector search on every query,
 * then merges the two ranked lists using RRF. This nails exact-symbol queries
 * ("getLogger" scores 0.408 semantically — misses the floor) while preserving
 * semantic quality for natural-language queries.
 *
 * RRF merges ranked lists without needing score calibration between systems:
 *   RRF_score(d) = Σ 1 / (k + rank_i(d))
 * where k=60 is the standard smoothing constant.
 *
 * The injection floor applies to the FUSED similarity (not raw component scores),
 * so a document that only scores well on one axis still needs enough combined
 * signal to inject.
 */

import type { SearchResult } from '../storage/lance-client.js';
import { keywordSearch, type KeywordSearchResult } from './keyword.js';
import type { ContextRow } from '../storage/lance-client.js';

/** RRF smoothing constant (standard value from the original paper). */
const RRF_K = 60;

export interface HybridResult extends SearchResult {
  rrfScore: number;
  semanticRank: number | null;
  keywordRank: number | null;
}

/**
 * Fuse semantic (vector) results with keyword results using Reciprocal Rank Fusion.
 *
 * Each result gets an RRF score based on its rank in each list it appears in.
 * The fused `similarity` is normalized to [0, 1] for downstream compatibility
 * (floor, reranker).
 */
export function fuseRRF(
  semanticResults: SearchResult[],
  keywordResults: KeywordSearchResult[],
  topK: number
): HybridResult[] {
  // Build rank maps (1-indexed)
  const semanticRank = new Map<string, number>();
  semanticResults.forEach((r, i) => semanticRank.set(r.id, i + 1));

  const keywordRank = new Map<string, number>();
  keywordResults.forEach((r, i) => keywordRank.set(r.id, i + 1));

  // Collect all unique document IDs
  const allIds = new Set([...semanticResults.map((r) => r.id), ...keywordResults.map((r) => r.id)]);

  // Build a lookup for the full result data (prefer semantic as it has the vector)
  const resultData = new Map<string, SearchResult>();
  for (const r of keywordResults) resultData.set(r.id, r);
  for (const r of semanticResults) resultData.set(r.id, r); // semantic overwrites

  // Compute RRF scores
  const scored: Array<{
    id: string;
    rrfScore: number;
    sRank: number | null;
    kRank: number | null;
  }> = [];
  for (const id of allIds) {
    let rrfScore = 0;
    const sRank = semanticRank.get(id) ?? null;
    const kRank = keywordRank.get(id) ?? null;

    if (sRank !== null) rrfScore += 1 / (RRF_K + sRank);
    if (kRank !== null) rrfScore += 1 / (RRF_K + kRank);

    scored.push({ id, rrfScore, sRank, kRank });
  }

  // Sort by RRF score descending, take topK
  scored.sort((a, b) => b.rrfScore - a.rrfScore);
  const top = scored.slice(0, topK);

  if (top.length === 0) return [];

  // Normalize RRF scores to [0, 1] for downstream pipeline compatibility.
  // The fused similarity is what the floor gates on.
  const maxRRF = top[0].rrfScore;

  return top.map((s) => {
    const data = resultData.get(s.id)!;
    return {
      ...data,
      similarity: s.rrfScore / maxRRF,
      distance: 1 - s.rrfScore / maxRRF,
      rrfScore: s.rrfScore,
      semanticRank: s.sRank,
      keywordRank: s.kRank
    };
  });
}

export interface HybridSearchOptions {
  topK: number;
  corpus: ContextRow[];
}

/**
 * Run keyword search component of hybrid search. Called from the daemon alongside
 * the vector search. Returns keyword results ready for RRF fusion.
 *
 * Separated from fuseRRF so the daemon can run keyword search in parallel with
 * vector search (keyword is CPU-bound, vector is IO-bound to LanceDB).
 */
export function hybridKeywordSearch(
  corpus: ContextRow[],
  query: string,
  topK: number
): KeywordSearchResult[] {
  // Keyword search uses a wider fetch (topK * 3) to give RRF more candidates
  return keywordSearch(corpus, query, topK * 3);
}
