---
name: retrieval-pipeline
description: The 9-step retrieval spine from prompt to injection, and what each stage does
metadata:
  type: implementation
  tags: [retrieval, pipeline, query, daemon]
---

# Retrieval Pipeline Implementation

The **retrieval pipeline** is the 9-step spine that transforms a user prompt into formatted context injection. Runs on every `/query` request.

## Pipeline Overview

```
User prompt
  ↓
1. Embed prompt (768-dim vector)
  ↓
2. Hybrid search (semantic + keyword fusion)
  ↓
3. Multi-vector expansion (if adaptive/always)
  ↓
4. Rerank (by similarity, type boost, recency)
  ↓
5. Collapse by file (keep best chunk per file)
  ↓
6. Top-K (trim to configured limit)
  ↓
7. Dedupe (remove near-duplicate files)
  ↓
8. Injection floor (drop below threshold)
  ↓
9. Format (wrap in [contextus — filename] blocks)
  ↓
Injected context (or no-inject if floor dropped all)
```

## Step-by-Step

### 1. Embed Prompt

**Input:** User's text prompt
**Output:** 768-dimensional vector

```typescript
const vec = await embedQuery(prompt);
```

**Provider:** Ollama (nomic-embed-text) or Transformers.js

**Fallback:** If embedding fails, try keyword-only search (BM25).

**Time:** ~10-50ms

---

### 2. Hybrid Search

**Input:** Query vector
**Output:** Ranked results (semantic + keyword fused)

```typescript
const [semanticResults, keywordResults] = await Promise.all([
  search(vec, fetchLimit, undefined, project),
  hybridKeywordSearch(corpus, prompt, cfg.retrieval.topK)
]);
const raw = fuseRRF(semanticResults, keywordResults, fetchLimit);
```

**Fusion:** Reciprocal Rank Fusion (RRF) merges both lists.

**Fetch limit:** `topK * 4` (over-fetch for later stages to trim).

**Time:** ~30-80ms (parallel execution)

---

### 3. Multi-Vector Expansion (Conditional)

**Input:** Initial search results
**Output:** Expanded results (unioned with variant searches)

**Trigger:**
- `mode=adaptive` AND `bestScore < 0.55` → YES
- `mode=always` → YES
- `mode=off` → NO

**Process:**
1. Generate 3 query variants via LLM (qwen2.5:3b / Haiku)
2. Embed each variant
3. Search with each vector
4. Union all results (dedupe by row ID, keep highest similarity)

**Time:** +100-400ms (when it fires)

---

### 4. Rerank

**Input:** Raw search results
**Output:** Re-ordered results (by finalScore)

```typescript
const ranked = rerank(raw);
```

**Scoring formula:**
```typescript
finalScore = similarity 
  + (typeBoost * TYPE_WEIGHTS[type])
  + recencyBoost
```

**Type weights:**
- `gotcha`: 0.15
- `decision`: 0.10
- `implementation`: 0.08
- `reference`: 0.0 (baseline)

**Recency boost:** Small boost for patterns hit in last 7 days.

**Purpose:** Prioritize high-value patterns (gotchas, decisions) over generic references.

**Time:** <1ms

---

### 5. Collapse by File

**Input:** Ranked chunks
**Output:** One best chunk per file

```typescript
const byFile = collapseByFile(ranked);
```

**Why:** A file's multiple chunks aren't competing matches — they're different sections of the same context. Keep the best representative chunk per file.

**Time:** <1ms

---

### 6. Top-K Trim

**Input:** Collapsed results
**Output:** Top N files (configured by `retrieval.topK`)

```typescript
const topK = byFile.slice(0, cfg.retrieval.topK);
```

**Default topK:** 5

**Purpose:** Limit token overhead (more patterns = more tokens).

**Time:** <1ms

---

### 7. Dedupe

**Input:** Top-K files
**Output:** Near-duplicates removed

```typescript
const { kept: deduped } = dedupe(topK);
```

**Algorithm:** Compares file content hashes, keeps one if >90% similar.

**Purpose:** Avoid injecting two versions of the same pattern (e.g., old copy + new copy).

**Time:** <1ms

---

### 8. Injection Floor

**Input:** Deduped results
**Output:** Patterns above similarity threshold

```typescript
const { kept, dropped, noInject } = applyFloor(deduped, cfg.retrieval.injectionFloor);
```

**Floor:** `retrieval.injectionFloor` (default: 0.45)

**Purpose:** Don't inject garbage — below the floor, nothing injects.

**Logging:** Dropped patterns logged with scores (for calibration).

**Time:** <1ms

---

### 9. Format

**Input:** Patterns above floor
**Output:** Formatted injection block

```typescript
const block = formatInjection(kept);
const footer = cfg.retrieval.provenanceFooter 
  ? renderFooterInstruction(kept) 
  : '';

return {
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: block + footer
  }
};
```

**Format:**
```markdown
[contextus — dev/LOGGING.md]

Logging uses structured JSONL...

---

[contextus — calibration.md]

Calibration works by...

[contextus notice] Patterns above injected from: dev/LOGGING.md (0.72), calibration.md (0.58)
```

**Footer:** Lists injected patterns + scores (if `provenanceFooter: true`).

**Time:** <1ms

---

## Total Pipeline Latency

**Typical (semantic only):**
- Embed: 10-50ms
- Search: 30-80ms
- Rerank/collapse/dedupe/floor: 1-2ms
- **Total: ~50-150ms**

**With hybrid (always on):**
- +20ms keyword search overhead
- **Total: ~70-180ms**

**With expansion (adaptive fires):**
- +100-400ms (Ollama qwen2.5:3b)
- **Total: ~150-550ms**

## Graceful Degradation

Pipeline returns `{"continue": true}` (no injection) when:
- Model not warm yet
- No corpus exists
- Embedding fails (after keyword fallback attempt)
- All results below floor

**Never blocks the prompt.**

## Observability

**Logged per query:**
```json
{
  "event": "retrieval",
  "project": "/path/to/project",
  "promptHash": "abc123",
  "retrieved": ["dev/LOGGING.md", "calibration.md"],
  "similarityScores": [0.72, 0.58],
  "tokensInjected": 342,
  "latencyMs": 145,
  "floorDropped": [
    { "pattern": "reference/unused.md", "score": 0.38 }
  ]
}
```

## Code Location

- `daemon/server.ts` — Full pipeline in `handleQuery()` (lines 167-466)
- `lib/retrieval/reranker.ts` — Step 4 (rerank)
- `lib/retrieval/dedup.ts` — Steps 5 (collapse) and 7 (dedupe)
- `lib/retrieval/floor.ts` — Step 8 (floor)
- `lib/retrieval/inject-format.ts` — Step 9 (format)

## Related

- **Hybrid search** — Step 2 fusion
- **Query expansion** — Step 3 conditional
- **Injection floor** — Step 8 gate
- **Reranking** — Step 4 prioritization
