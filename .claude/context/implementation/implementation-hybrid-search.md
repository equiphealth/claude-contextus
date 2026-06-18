---
name: hybrid-search
description: How hybrid search fuses semantic vector search with keyword BM25 search using Reciprocal Rank Fusion
metadata:
  type: implementation
  tags: [retrieval, search, rrf, keyword, semantic]
---

# Hybrid Search Implementation

Hybrid search combines **semantic vector search** (meaning-based) with **keyword search** (exact-match BM25) and fuses them using **Reciprocal Rank Fusion (RRF)**.

## Why Hybrid?

Pure semantic search struggles with exact symbols:
- Query: "getLogger function"
- Semantic score: 0.408 (below 0.45 floor → no injection)
- Keyword match: Exact hit on "getLogger" → ranks #1

Hybrid search ensures exact-symbol queries like function names, class names, or config keys get retrieved even when embeddings dilute them.

## How RRF Works

**Reciprocal Rank Fusion** merges two ranked lists without needing to calibrate their scores:

```
RRF_score(document) = Σ 1 / (k + rank_i(document))
```

Where:
- `k = 60` (standard smoothing constant from the RRF paper)
- `rank_i` = position of document in list i (1-indexed)
- Sum across all lists the document appears in

**Example:**
- Document appears at rank 3 in semantic, rank 1 in keyword
- RRF score = `1/(60+3) + 1/(60+1)` = `0.0159 + 0.0164` = `0.0323`

Documents appearing in both lists get higher scores than those in only one.

## Pipeline Integration

**Parallel execution** (happens in daemon/server.ts `/query` handler):

1. **Embed prompt** → 768-dim vector
2. **Launch in parallel:**
   - Vector search → LanceDB similarity search
   - Keyword search → BM25 over corpus text
3. **Fuse with RRF** → Single ranked list
4. **Normalize to [0, 1]** → Downstream pipeline expects similarity scores

The fused similarity is what the injection floor gates on.

## Configuration

```jsonc
{
  "retrieval": {
    "hybrid": "always" | "off"
  }
}
```

- `"always"` — Run hybrid on every query (~20ms keyword overhead)
- `"off"` — Pure semantic search

**Default:** `"always"` (deployed in plugin.jsonc)

## Keyword Search Details

- **Algorithm:** BM25 (best-match scoring, standard IR algorithm)
- **Corpus:** Loads all context file text into memory
- **Fetch limit:** `topK * 3` (wider than semantic to give RRF more candidates)
- **Parallel:** Runs alongside vector search (keyword is CPU-bound, vector is IO-bound)

## Normalization

RRF scores are normalized to `[0, 1]` for pipeline compatibility:
```typescript
const maxRRF = top[0].rrfScore;
normalizedSimilarity = rrfScore / maxRRF;
```

The highest-scoring document gets similarity = 1.0.

## Result Shape

Hybrid results include provenance fields:
```typescript
interface HybridResult extends SearchResult {
  rrfScore: number;           // Raw RRF score
  semanticRank: number | null; // Position in vector results (null if not present)
  keywordRank: number | null;  // Position in keyword results (null if not present)
  similarity: number;          // Normalized RRF score (for floor)
}
```

## Tradeoffs

**Pros:**
- Exact-symbol coverage (function names, config keys)
- No score calibration needed (RRF is rank-based)
- Parallel execution keeps latency low

**Cons:**
- +20ms overhead per query (keyword scan)
- Loads full corpus into memory (fine for <1000 patterns, watch for scale)
- Keyword search is simplistic (no stemming, no fuzzy matching)

## Code Location

- `lib/retrieval/hybrid.ts` — RRF fusion logic
- `lib/retrieval/keyword.ts` — BM25 implementation
- `daemon/server.ts` — Parallel execution in `/query` handler (lines 235-246)

## Related

- **Query expansion** — Runs AFTER hybrid search produces initial results
- **Injection floor** — Gates on the fused similarity, not raw component scores
- **Keyword fallback** — Different feature (provider-down degradation, not fusion)
