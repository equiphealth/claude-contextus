/**
 * Keyword search — BM25-inspired text scan over stored document content.
 *
 * Fires as a FALLBACK when the embedding provider is unreachable (not when it's
 * slow — that path already degrades gracefully). Gives SOME retrieval when Ollama
 * is down instead of complete silence.
 *
 * Not a full BM25 implementation (no IDF precomputation across the corpus), but
 * close enough for a fallback: term frequency with length normalization and
 * diminishing returns on repeated terms.
 *
 * Results are tagged `source: 'keyword'` so provenance is transparent.
 */

import type { SearchResult, ContextRow } from '../storage/lance-client.js';

/** BM25 parameters (standard defaults). */
const K1 = 1.2;
const B = 0.75;

/** Tokenize text into lowercase terms, stripping punctuation. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** Compute term frequency map for a token list. */
function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/**
 * Score a single document against query terms using BM25-like scoring.
 * `avgDl` is the average document length across the corpus.
 * `df` is the document frequency map (how many docs contain each term).
 * `N` is the total number of documents.
 */
function scoreBM25(
  docTokens: string[],
  queryTerms: string[],
  avgDl: number,
  df: Map<string, number>,
  N: number
): number {
  const docTf = termFreq(docTokens);
  const dl = docTokens.length;
  let score = 0;

  for (const term of queryTerms) {
    const freq = docTf.get(term) ?? 0;
    if (freq === 0) continue;

    // IDF with smoothing
    const docFreq = df.get(term) ?? 0;
    const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);

    // BM25 TF component
    const tf = (freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (dl / avgDl)));

    score += idf * tf;
  }

  return score;
}

export interface KeywordSearchResult extends SearchResult {
  keywordScore: number;
}

/**
 * Search documents by keyword matching. Returns results sorted by BM25 score,
 * with a synthetic `similarity` in [0, 1] range (normalized against the best
 * score in the result set) for compatibility with the downstream pipeline.
 *
 * Short/vague queries (< 2 meaningful terms) return empty — keyword search needs
 * specificity to avoid garbage.
 */
export function keywordSearch(
  rows: Pick<
    ContextRow,
    | 'id'
    | 'document'
    | 'filename'
    | 'chunk_index'
    | 'heading'
    | 'type'
    | 'source'
    | 'tags'
    | 'hit_count'
    | 'last_hit'
    | 'updated_at'
    | 'content_hash'
  >[],
  query: string,
  topK: number
): KeywordSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length < 2) return [];

  // Precompute corpus stats
  const docTokensList = rows.map((r) => tokenize(r.document));
  const N = rows.length;
  const avgDl = N > 0 ? docTokensList.reduce((sum, t) => sum + t.length, 0) / N : 1;

  // Document frequency
  const df = new Map<string, number>();
  for (const tokens of docTokensList) {
    const unique = new Set(tokens);
    for (const t of unique) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  // Score all documents
  const scored = rows.map((row, i) => ({
    row,
    score: scoreBM25(docTokensList[i], queryTokens, avgDl, df, N)
  }));

  // Filter to non-zero scores, sort descending, take topK
  const results = scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  if (results.length === 0) return [];

  // Normalize scores to [0, 1] range for pipeline compatibility
  const maxScore = results[0].score;

  return results.map((r) => ({
    ...r.row,
    vector: [], // no vector in keyword results
    distance: 1 - r.score / maxScore,
    similarity: r.score / maxScore,
    keywordScore: r.score
  }));
}

// In-memory corpus cache — avoids re-reading all rows from disk on every hybrid query.
const _corpusCache = new Map<string, { rows: ContextRow[]; loadedAt: number }>();

/** Invalidate the keyword corpus cache for a project (call on notify/reconcile). */
export function invalidateCorpusCache(projectName?: string): void {
  _corpusCache.delete(projectName ?? '__default__');
}

/**
 * Load all rows from the corpus for keyword scanning. Cached in memory and
 * invalidated on file changes (notify/reconcile). Without caching, this was
 * the primary latency bottleneck (~5s to read 1207 rows from LanceDB on every query).
 */
export async function loadCorpusForKeyword(projectName?: string): Promise<ContextRow[]> {
  const cacheKey = projectName ?? '__default__';
  const cached = _corpusCache.get(cacheKey);
  if (cached) return cached.rows;

  // Lazy import to avoid circular dependency with lance-client
  const { openTable, tableExists } = await import('../storage/lance-client.js');
  if (!(await tableExists(projectName))) return [];
  const table = await openTable(projectName);
  const rows = (await table
    .query()
    .select([
      'id',
      'document',
      'filename',
      'chunk_index',
      'heading',
      'type',
      'source',
      'tags',
      'hit_count',
      'last_hit',
      'updated_at',
      'content_hash'
    ])
    .toArray()) as ContextRow[];
  _corpusCache.set(cacheKey, { rows, loadedAt: Date.now() });
  return rows;
}
