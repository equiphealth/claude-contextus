---
name: query-expansion
description: How multi-vector query expansion generates alternate phrasings and when it fires (adaptive mode)
metadata:
  type: implementation
  tags: [retrieval, expansion, llm, ollama, bedrock]
---

# Query Expansion Implementation

**Multi-vector query expansion** generates alternate phrasings of the user's prompt, embeds each, searches with all variants, and unions the results. This catches relevant patterns that the original phrasing missed.

## When It Fires

Three modes (config: `expansion.mode`):

1. **`"adaptive"`** (default) — Fires when `bestScore < 0.55`
   - Initial search scored poorly → try alternate phrasings
   - Most queries skip expansion (saves latency)

2. **`"always"`** — Every query gets expansion
   - +100-400ms latency per query
   - Maximum recall, regardless of initial score

3. **`"off"`** — Never expands
   - Lowest latency, semantic-only

**Threshold:** `expansion.expansionThreshold` (default: 0.55)

## How It Works

1. **Check if expansion should fire** (`shouldExpand()`)
   - `mode=off` → no
   - `mode=always` → yes
   - `mode=adaptive` → yes if `bestScore < threshold`

2. **Generate variants** via LLM
   - Prompt: "Rephrase this query into 3 alternatives with different words/synonyms"
   - Example: "configure database" → ["database settings", "set up db config", "change database URL"]
   - LLM provider: Ollama (qwen2.5:3b) or Bedrock (Haiku)

3. **Embed each variant** (parallel)
   - Original prompt: 768-dim vector
   - Variant 1: 768-dim vector
   - Variant 2: 768-dim vector
   - Variant 3: 768-dim vector

4. **Search with each vector** (parallel)
   - Smaller fetch limit per variant (`topK * 2`) — breadth comes from union
   - Each search returns top matches for that phrasing

5. **Union results**
   - Merge all searches (original + variants)
   - Dedupe by row ID (keep highest similarity per document)
   - Continue through rerank → floor → inject

## Provider Chain

**Primary:** Ollama (local, fast)
- Model: `qwen2.5:3b` (small, fast generation)
- Latency: 100-400ms
- Requires: Ollama running on localhost:11434

**Fallback:** Bedrock (AWS, slower)
- Model: `claude-haiku-3-5` (or configured model)
- Latency: ~2s
- Triggered when: Ollama fails fast AND remaining time budget > 500ms
- Requires: AWS credentials via default chain

**Shared timeout budget:** If Ollama times out slowly, fallback is skipped (don't pile latency on latency).

## Configuration

```jsonc
{
  "expansion": {
    "mode": "adaptive",              // "adaptive" | "always" | "off"
    "expansionThreshold": 0.55,      // Adaptive fires below this
    "maxVariants": 3,                // Number of alternate phrasings
    "provider": "ollama",            // Primary: "ollama" | "bedrock" | "anthropic"
    "model": "qwen2.5:3b",           // Model for primary provider
    "fallbackProvider": "bedrock",   // Fallback provider (optional)
    "fallbackModel": "claude-haiku-3-5", // Fallback model
    "temperature": 0.3,              // LLM temperature (low = less creative)
    "timeoutMs": 5000                // Total timeout (primary + fallback)
  },
  "providers": {
    "ollama": {
      "endpoint": "http://localhost:11434"
    },
    "bedrock": {
      "region": "us-east-1"
    }
  }
}
```

## Prompt Template

```
TASK: Rephrase the query below into {{count}} alternative search queries.
Do NOT answer the query. Do NOT explain anything.
Output ONLY the rephrased queries, one per line.

RULES:
- Each rephrasing must be a SHORT question or phrase (under 20 words)
- Use DIFFERENT words/synonyms (e.g. "embedding model" → "vector encoder")
- Preserve the original intent — just change the wording
- No numbering, no bullets, no preamble

Query: {{query}}
Output:
```

## Parsing Variants

Output is split by newline, filtered:
- Min 5 chars (skip empty lines)
- Max 200 chars (skip nonsense)
- Take first `maxVariants` (ignore extras)

## Stats Tracking

Daemon tracks expansion stats (in-memory):
```json
{
  "expansion": {
    "queries": 42,       // Total queries processed
    "fired": 5,          // How many triggered expansion
    "skipped": 37,       // How many skipped (above threshold)
    "fireRate": "11.9%"  // fired / queries
  }
}
```

Available via `GET /health`.

## Logging

When expansion fires:
```json
{
  "event": "Expansion fired",
  "variants": ["database settings", "db config"],
  "provider": "ollama/qwen2.5:3b",
  "latencyMs": 342,
  "resultsBefore": 8,
  "resultsAfter": 15
}
```

When skipped:
```json
{
  "event": "Expansion skipped",
  "initialBest": 0.68,
  "threshold": 0.55
}
```

## Tradeoffs

**Pros:**
- Catches phrasings the original embedding missed
- Adaptive mode keeps latency low (most queries skip it)
- Fallback chain provides reliability

**Cons:**
- Adds 100-400ms latency when it fires
- Depends on external LLM (Ollama/Bedrock)
- Generates ~3x more embedding + search work
- No guarantee variants are better (LLM might generate poor rephrases)

## Code Location

- `lib/retrieval/expand.ts` — Expansion logic, provider calls, fallback
- `daemon/server.ts` — Integration in `/query` handler (lines 287-338)

## Related

- **Hybrid search** — Runs BEFORE expansion (expansion works on hybrid-fused results)
- **Keyword fallback** — Different feature (provider-down degradation, not expansion)
- **Injection floor** — Still applies to expanded results
