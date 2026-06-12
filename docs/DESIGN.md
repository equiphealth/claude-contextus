# claude-contextus: Design & Implementation

_Last updated: June 12, 2026_

**Status**: Core scaffolding complete, implementation in progress

**Repository**: <https://github.com/anthonypdawson/claude-contextus> (private)

## Overview

This document describes how to implement automatic semantic retrieval for the `.claude/context/` system using vector embeddings and Chroma. This upgrades manual index scanning to automatic, meaning-based context injection.

**Important**: This is a **separate system** from claude-mem. Both use Chroma but serve different purposes:

| Feature             | claude-contextus (this doc)                 | claude-mem                               |
| ------------------- | ------------------------------------------- | ---------------------------------------- |
| **Purpose**         | Inject curated `.claude/context/` patterns  | Track tool use observations (memory)     |
| **Source**          | Hand-written markdown files + docs          | Auto-generated from PostToolUse hook     |
| **Scope**           | Normative rules/patterns (context)          | Historical activity log (memory)         |
| **Retrieval Mode**  | **Automatic** (every prompt, no commands)   | **Manual** (`/mem-search`, `timeline()`) |
| **User Experience** | Proactive, ambient, zero-query              | Reactive, explicit search required       |
| **Chroma Mode**     | File-based (`~/.contextus/data/{project}/`) | Server-based (`localhost:8000`)          |
| **Version Control** | Source files committed; DB in user space    | Stored in `~/.claude-mem/`               |
| **Config**          | `CONTEXTUS_RAG_*` env vars                  | `CLAUDE_MEM_*` env vars                  |
| **Team Sharing**    | Source files yes (git-tracked); DB no       | No (local per-user)                      |

## Key Architectural Decisions

These decisions are settled. Do not re-litigate without strong evidence.

1. **Default embedding model**: `nomic-ai/nomic-embed-text-v1.5` (768 dim, 138MB). Rationale: technical domain vocabulary (Appium, WebdriverIO, BrowserStack), negligible size overhead at target corpus scale (<200 docs), better semantic understanding for technical prose than MiniLM. Model is user-configurable — see Embedding Providers.
1. **Storage location**: ChromaDB in `~/.contextus/data/{project}/` (user space), not git-committed.
1. **Daemon architecture**: Persistent HTTP daemon instead of stateless hooks (solves model warm-up latency).
1. **Daemon lifecycle**: Single shared daemon across all projects (one embedding model loaded once), graceful degradation on crash.
1. **Chunking strategy**: Chunk long docs with breadcrumb injection; freeform human-written docs use dual embedding (whole-doc overview + chunks).
1. **Embedding model validation**: Store model name in collection metadata, validate on query to prevent silent failures. Model change requires full rebuild.
1. **Awareness hook**: Opt-out framing (“omit only if trivial”), separate JS script for cross-platform safety.
1. **Result destructuring**: Correct Chroma parallel array handling (ids/documents/metadatas/distances).
1. **Proactive capture**: The awareness hook handles proactive context creation. Retrieval quality is what makes captured patterns useful. These are complementary, not competing concerns.
1. **Capture modes**: `propose` (default, safe) vs `auto` (autonomous) vs `silent` (retrieval only). These are a permanent tradeoff, not a ramp — `propose`'s human judgment is the corpus quality gate, and for most users it is the right permanent home. Auto-_injection_ (retrieval) is always on regardless; only auto-_capture_ carries the corpus-quality cost. See "Capture Mode Is a Tradeoff, Not a Graduation."
1. **Proposal format**: Footer includes slug + novelty signal derived from injected context already present — no extra daemon round trip on UserPromptSubmit.
1. **Retrieval frequency tracking**: Increment hit counter in Chroma metadata on every retrieval. Used for re-ranking and calibration dashboard.
1. **Dedup and retrieval thresholds**: Tuned independently. Dedup threshold (creation) and retrieval threshold (query) serve different purposes and should not share a value.
1. **Injection floor**: A similarity floor below which nothing is injected. Vector search always returns a top-K with no natural zero; the floor restores the self-gating that keyword search provided implicitly. No-inject is a first-class, logged outcome — not every prompt should receive context. Calibrate empirically per model, do not hardcode.

## Vision: Proactive Context, Not Search

The killer feature isn't "better search" — it's **no search at all**.

**Traditional RAG** is reactive:

- User asks question → searches manually → retrieves results → applies to task
- Requires remembering _what_ to search for and _when_ to search
- Context retrieval is an interruption, not an enhancement

**claude-contextus** is proactive:

- Context appears automatically on every prompt (no `/search` commands)
- System proposes what to capture as you work (no "did I document that?" anxiety)
- Learns which patterns are useful vs. noise (self-tuning retrieval quality)
- Calibrates to your project over time (hit tracking + feedback loop)

**The user experience**:

1. **Zero cognitive load**: You never think "I should search for that pattern." It's just there.
2. **Automatic capture**: Claude says "Context: propose: error-handling" when you solve something novel.
3. **Self-improving**: The more you use it, the better it gets at knowing what matters.

This transforms knowledge management from **"I hope I remember to search"** to **"it just works."**

The technical implementation below (embeddings, re-ranking, compression) exists to make this seamless experience possible at <200ms latency with high precision.

## The Core Workflow

The system closes two loops:

**Capture loop** (awareness hook → user action → context file written → PostToolUse triggers incremental re-embed)

**Retrieval loop** (UserPromptSubmit → daemon query → top-k injected into context → Claude responds with relevant patterns available)

Retrieval quality directly determines the ROI of everything captured. The `propose` calibration phase is how you develop confidence in the retrieval pipeline — and for most users it is also the permanent capture mode, not just a stepping stone to `auto`. See "Capture Mode Is a Tradeoff, Not a Graduation."

## Calibration Strategy

The path from install to a tuned, trusted retrieval pipeline:

1. **Calibrate the injection floor first** (see below). Until the floor is set, retrieval will either inject noise or stay silent unpredictably.
1. Run in `propose` mode. Review footer proposals after each session.
1. Use `/context-debug` as your calibration dashboard — precision, recall, zero-hit patterns, stale embeddings.
1. Watch for `[similar: x]` proposals you’d actually want to capture separately → lower dedup threshold.
1. Watch for `[new]` proposals that are obvious duplicates → raise dedup threshold.
1. A/B test nomic vs MiniLM on a fixed query set before committing (at ~90 docs, reindex cost is minutes).
1. Decide your permanent capture mode. `propose` stays the default for most users — the human judgment is the corpus quality gate. `auto` is available for low-stakes corpora or users who prune by exception. This is a tradeoff, not a finish line — see "Capture Mode Is a Tradeoff, Not a Graduation."

### Calibrating the Injection Floor (Do This First)

The floor is model-dependent and is best derived from real data, not guessed. This is the highest-leverage early task because it gates retrieval quality entirely — and it doubles as the validation that semantic retrieval beats the keyword baseline.

1. Embed the existing corpus.
1. Replay a set of real historical prompts through retrieval. Log every prompt's top-K similarity scores.
1. For each result, judge (by hand) whether that injection would have been _wanted_.
1. Plot wanted/unwanted against similarity. The floor is the score below which "wanted" essentially never occurs.
1. This same replay is an A/B harness: keyword (baseline) vs. embeddings (new) on identical prompts. If embeddings don't beat keyword on judged usefulness, the floor calibration has told you something important before any daemon code exists.

This requires a real prompt history and a curated corpus — both of which a current keyword-based user already has.

**Note on existing corpus**: Context patterns written during long single-session workflows may be written for a different use case — they may capture conversational context rather than durable patterns. Retrieval frequency tracking will surface these quickly (zero-hit patterns after 20-30 sessions are candidates for rewrite or deletion).

## Proactive Creation & Proposal Scoring

### Capture Modes

Configurable per project in `.claude/settings.json`:

```json
{
  "claudeContextus": {
    "capture": {
      "mode": "propose" // "propose" | "auto" | "silent"
    }
  }
}
```

- **propose**: Claude appends a footer with the proposed context slug and novelty signal. User acts or ignores.
- **auto**: Claude writes the context file directly via PostToolUse. No user action required.
- **silent**: No proposals, no auto-save. Retrieval only.

### Capture Mode Is a Tradeoff, Not a Graduation

It is tempting to read the progression as `propose` → tune → `auto` → sit back, with `auto` as the finish line. **It is not.** `auto` is the most hands-off setting, not the most correct one, and for most users `propose` is the right permanent home.

**Separate two things the word "auto" conflates:**

- **Auto-_injection_** (retrieval, zero friction) — this is the magic, and it is always on. You never approve a retrieval.
- **Auto-_capture_** (writing new patterns without review) — this is a different decision with a real cost.

Calibration tunes _retrieval_ — the floor, thresholds, re-ranking. Those answer "given a corpus, what do I surface?" They do **not** govern what enters the corpus. A perfectly calibrated retriever over a degrading corpus still degrades: the floor filters _relevance_, not _quality_. A plausible-but-not-durable pattern that is lexically on-topic clears the floor exactly like a real one — the difference between them is semantic, and no threshold can see it.

**What `propose` is quietly doing:** every approve/ignore is a human judgment about durability — "is this a timeless rule or conversational residue?" That judgment is the corpus's quality gate. `auto` removes it. The risk is not volume (dedup handles that); it is slow accretion of near-misses that erode retrieval quality so gradually you never notice the day it started.

**The honest framing:**

| Mode      | Friction         | Cost                                               | Best for                                        |
| --------- | ---------------- | -------------------------------------------------- | ----------------------------------------------- |
| `propose` | ~2s per approval | Tiny ongoing attention                             | Corpora you want to stay clean indefinitely     |
| `auto`    | Zero             | Slow corpus-quality tax; needs review-by-exception | Low-stakes corpora, or users who prune actively |
| `silent`  | Zero             | No capture at all                                  | Pure retrieval over a frozen corpus             |

The ~2-second friction in `propose` is not a bug to optimize away — it may be the feature that keeps the system working over months. Pick based on how much you trust the corpus to stay clean without a gardener.

**If running `auto`, review by exception.** `auto` does not mean "never look again." The hit-tracking metadata is the safety net: a pattern auto-captured 30 sessions ago with zero hits is almost certainly noise. `/context-calibrate` should periodically surface _"these N auto-captured patterns have never been retrieved — prune?"_ — keeping the corpus honest with a couple of minutes a month. That is still hands-off; it is just not blind.

### Proposal Footer Format

The awareness hook runs on every UserPromptSubmit alongside the query hook. It has visibility into which context patterns were injected by the query hook.

**Novelty signal is derived from injected context — no extra daemon round trip.**

If Claude is proposing something not represented in the retrieved context, that is already a novelty signal. If it is similar to something retrieved, the retrieved pattern name is the reference.

```
Context: propose: wdio-element-visibility-workaround [new]
Context: propose: appium-session-reset [similar: wdio-session-handling]
```

- `[new]` — not represented in retrieved context for this session
- `[similar: x]` — close to a retrieved pattern; consider whether it merits a separate entry

**Weakness**: Retrieval is top-k filtered, so something may exist in the DB but not be retrieved for this prompt. At <200 documents this is an acceptable false positive rate — the user catches it on review.

### Awareness Hook Implementation

Separate JS script to avoid cross-platform shell escaping issues:

```javascript
// scripts/awareness-hook.js
console.log(
  JSON.stringify({
    continue: true,
    hookSpecificOutput: {
      additionalContext:
        'Context awareness: Unless this response is purely trivial ' +
        '(e.g. a one-line answer, yes/no, or acknowledgment), append footer: ' +
        'Context: propose: topic-name [new|similar: x] if ANY new pattern, ' +
        'detail, or context was discussed that is not already covered by the ' +
        'injected context above. Omit only if truly nothing reusable was covered.',
    },
  })
);
```

### Rejected Proposals

No confirmation prompt — act or ignore. Passive rejection signal is inferred from proposal frequency vs. capture rate. `/context-debug` surfaces: “these topics have been proposed 5+ times and never saved — consider raising the threshold or adjusting the awareness prompt.”

**Rejection tracking TTL**: Rejected proposals should have a session window or context-based reset. If new related context patterns are added, previously-rejected proposals may become valid. Suggest 30-session TTL or reset when related context changes are detected.

## Current State (Manual)

**How it works now:**

1. `CONTEXT.md` index loaded into context (~2-3k tokens)
1. Claude manually scans index to find relevant patterns
1. Claude reads individual context files on-demand
1. Relies on keyword matching in descriptions

**Limitations:**

- Manual discoverability requires scanning 88+ entries
- Limited to keyword matching in descriptions
- No synonym or semantic understanding
- Misses relevant patterns if keywords don’t align

## Proposed State (Automatic RAG)

**How it would work:**

1. All context files + docs embedded into Chroma vector database
1. On every `UserPromptSubmit`, semantic search for top-k relevant patterns
1. Inject top 3-5 pattern contents directly into context
1. Dynamic relevance: only load what’s needed for this specific prompt

**Benefits:**

- ✅ **Token efficient**: Load ~2-3k tokens instead of scanning 88-entry index
- ✅ **Semantic matching**: “How do I debug?” → matches Logger Helper pattern
- ✅ **Synonym-aware**: “print”, “log”, “console” all match
- ✅ **Scales**: Can grow to 200+ patterns without context pressure
- ✅ **Zero maintenance**: No manual keywords or tagging needed

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                   UserPromptSubmit                      │
│                                                         │
│  1. User sends prompt                                   │
│  2. Query hook: POST to daemon /query                   │
│  3. Daemon embeds prompt, queries Chroma                │
│  4. Inject top-k context patterns into context           │
│  5. Awareness hook: propose footer from injected set    │
│  6. Claude responds with relevant patterns available      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Chroma Database                       │
│                                                         │
│  Collection: "contextus"                                │
│    - Documents (one per context file / chunk)            │
│    - Metadata: file_path, category, type, source,       │
│                hit_count, last_hit, content_hash,       │
│                embedding_model                          │
│    - Embeddings: 768-dimensional (nomic default)        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Embedding Pipeline                    │
│                                                         │
│  Initial: Embed all .claude/context/**/*.md + docs/     │
│  Incremental: PostToolUse hook notifies daemon          │
│  Model: nomic-ai/nomic-embed-text-v1.5 (default)        │
│  User-configurable: see Embedding Providers             │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
User: "How do I log errors in tests?"
   ↓
Query hook: POST { prompt, project } to localhost:37800/query
   ↓
Daemon: embed prompt → [0.12, -0.43, 0.87, ...] (768 dim)
   ↓
Query Chroma (cosine similarity)
   ↓
Re-rank: similarity × sourceWeight × typeBoost × freshnessDecay × hitCountBoost
   ↓
Top matches:
  1. framework/feedback_use_logger_helper.md (0.92)
  2. testing/reference_test_session_artifacts.md (0.78)
  3. framework/feedback_identifying_crashes.md (0.71)
   ↓
Increment hit_count + last_hit for each match
   ↓
Read top 3 context files, format injection block
   ↓
Inject into context before Claude responds
   ↓
Claude: "Use getLogger() from ~/helpers/logger..."
   ↓
Awareness hook: "framework/feedback_use_logger_helper already injected
 → propose only if discussing something new"
```

## Document Chunking Strategy

**Decision**: Chunk longer documents to avoid truncation. Standard context patterns are typically short enough to embed whole. Human-written freeform docs use dual embedding.

**Rationale**: The default model (nomic-embed-text-v1.5) has a 512-token context window. For longer docs, chunking with overlap preserves semantic completeness.

**Chunking Parameters:**

- Chunk size: 512 tokens
- Overlap: 64 tokens (maintains context continuity across boundaries)
- Boundary preference: Split on markdown headers (`##`, `###`) when possible, fall back to token boundaries

### Freeform Doc Strategy (Dual Embedding)

Human-written docs have inconsistent structure — headers may be organizational rather than semantic (“Notes”, “Misc”). A single chunk pass misses broad topic matching.

**Dual approach:**

- Embed the whole doc as `type: doc-overview` (catches “this doc is about X”)
- Embed each chunk as `type: doc-chunk` (catches “this paragraph answers Y”)
- Overview entries get lower top-k priority; chunks compete normally

**When to use dual embedding:**

- Docs tagged as human-authored in frontmatter, or
- Files in `docs/` without structured frontmatter, or
- Any file >500 tokens without consistent markdown heading structure

**When NOT to use dual embedding:**

- Standard context files (<500 tokens) — embed whole
- Structured docs with meaningful headings — chunk only
- Code snippets — typically already excerpted

**Chunk Metadata:**

```javascript
{
  id: "docs/DESIGN.md#chunk-3",
  document: "... chunk content ...",
  metadata: {
    parent_file: "docs/DESIGN.md",       // relative path from project root
    chunk_index: 2,                       // 0-indexed
    chunk_total: 8,
    source: "projectDocs",
    type: "doc-chunk",                    // or "doc-overview", "context"
    hit_count: 0,
    last_hit: null,
    content_hash: "abc123",              // SHA-256 for staleness detection
    last_embedded: "2026-06-12T00:00:00Z",
    embedding_model: "nomic-ai/nomic-embed-text-v1.5"
  }
}
```

**Retrieval: Inject Chunk + Breadcrumb**

```markdown
### [Docs] DESIGN.md (chunk 3/8, similarity: 0.89)

> ## Daemon Architecture
>
> The daemon pattern solves the model warm-up problem by keeping
> a persistent process that loads the embedding model once...

**Full document**: `docs/DESIGN.md` (245 tokens total)
```

**Multiple Chunks from Same File (deduplicated):**

```markdown
### [Docs] DESIGN.md (3 matches, similarity: 0.89)

**Chunk 3/8**: Architecture section

> ... content ...

**Chunk 5/8**: Configuration section

> ... content ...

**Full document**: `docs/DESIGN.md`
```

Store relative paths from project root in metadata so `formatMemoriesForInjection` can dedupe breadcrumbs and paths remain portable across machines.

## Embedding Providers

Contextus supports multiple embedding strategies with automatic fallback. **Model is user-configurable** — the default is the recommended starting point, not a hard constraint.

### Provider Hierarchy (Best → Fallback)

1. **Transformers.js** (Default, Recommended)

- Pure JavaScript, runs in-process via daemon
- No external dependencies or servers
- Fast (~50-100ms per query after model load)
- Works offline
- **Default model**: `nomic-ai/nomic-embed-text-v1.5` (768 dim, 138MB)
  - Rationale: better semantic understanding for technical vocabulary; negligible size overhead at <200 doc corpus scale
- **Alternative**: `Xenova/all-MiniLM-L6-v2` (384 dim, 80MB) — faster, lower quality, familiar from past experiments
  ```typescript
  import { pipeline } from '@xenova/transformers';
  const embedder = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5');
  const embedding = await embedder(text, { pooling: 'mean', normalize: true });
  ```

1. **Ollama** (Opt-in, Power Users)

- Higher quality embeddings, user controls model
- Requires Ollama running locally
- Slightly slower (~100-200ms per query)
  ```typescript
  {
    "embedding": {
      "provider": "ollama",
      "model": "nomic-embed-text",
      "endpoint": "http://localhost:11434"
    }
  }
  ```

1. **Claude Semantic Matching** (Fallback)

- No embeddings, uses Haiku sub-agent
- Expands query → grep with synonyms → AI ranking
- Slower (~2-5s) but always works
  ```typescript
  // Query expansion with Haiku
  "fixing flaky tests" → ["flaky", "intermittent", "unstable", "timing", "waitForExist"]
  ```

1. **Keyword Search** (Ultimate Fallback)

- Plain grep if everything else fails
- Fast but no semantic understanding

### Critical: Embedding Model Consistency

A shared daemon only works if all projects use the **same embedding model**. Different models produce incompatible embedding spaces.

**Strategy:**

1. **Global default model** in `~/.contextus/config.json`, used by all projects
1. **Store model name** in collection metadata on index build
1. **Validate on every query**: if project DB was built with a different model, return error + instructions to rebuild
1. **Per-project override** forces a dedicated per-project daemon (Option B lifecycle)

**Model change requires full rebuild** — this is expected and documented. At <200 docs, rebuild takes minutes.

```typescript
async function validateProjectDB(projectName: string): Promise<void> {
  const collection = await chromaClient.getCollection('contextus');
  const metadata = await collection.metadata();

  if (metadata.embeddingModel !== DAEMON_MODEL) {
    throw new Error(
      `Project '${projectName}' was built with ${metadata.embeddingModel}, ` +
        `but daemon is running ${DAEMON_MODEL}. ` +
        `Run /rebuild-embeddings to regenerate with current model.`
    );
  }
}
```

### Configuration

```json
{
  "embedding": {
    "provider": "transformers",
    "model": "nomic-ai/nomic-embed-text-v1.5",
    "dimensions": 768,
    "ollama_model": "nomic-embed-text",
    "ollama_endpoint": "http://localhost:11434",
    "batchSize": 32
  },
  "search": {
    "enabled": true,
    "similarity_threshold": 0.7,
    "max_results": 10,
    "fallback_enabled": true
  }
}
```

**Note**: `dimensions` must match the model. 768 for nomic, 384 for MiniLM. Mismatch causes silent failure on first index build — validate this at collection creation time.

**Similarity threshold caveat**: The `0.7` default is model-dependent. Different embedding models have different similarity distributions. Prefer **top-K selection** (retrieve best N results) over hard thresholds. Use threshold as a quality filter _after_ ranking, not as a retrieval gate. Calibrate during testing with `/context-debug`.

### Performance Characteristics

| Provider                 | Initial Index (200 files) | Embedding | Offline  | Quality |
| ------------------------ | ------------------------- | --------- | -------- | ------- |
| Transformers.js (nomic)  | ~30s                      | ~80ms     | ✅ Yes   | Better  |
| Transformers.js (MiniLM) | ~20s                      | ~55ms     | ✅ Yes   | Good    |
| Ollama                   | ~30s                      | ~100ms    | ✅ Yes\* | Better  |
| Claude Semantic          | N/A                       | 2-5s      | ❌ No    | Good    |
| Keyword                  | N/A                       | N/A       | ✅ Yes   | Poor    |

\*Requires Ollama running locally

**End-to-end query latency** (UserPromptSubmit → context injected):

- Embedding generation: 50-100ms (nomic, warm daemon)
- Chroma query: 5-20ms
- Re-ranking: <5ms
- File reads (if needed): 5-30ms
- Compression + formatting: 5-15ms
- **Total: 100-200ms** typical, 300-500ms worst case

Target: <200ms p50, <500ms p95

## Multi-Model Architecture for Auxiliary Tasks

While embedding model selection governs corpus indexing, **auxiliary LLM tasks** (evaluation, deduplication, compression, diagnosis) can use different models optimized for cost, privacy, or latency.

**Design Principle**: The user's primary LLM (Sonnet/Opus) handles responses. Auxiliary models handle structured background tasks where cost, privacy, or speed matter more than max capability.

### Configurable Model Selection

```json
{
  "models": {
    "evaluation": {
      "provider": "anthropic",       // anthropic | openai | ollama | custom
      "model": "claude-haiku-4",     // Default: Haiku for cost efficiency
      "endpoint": null               // For ollama: "http://localhost:11434"
    },
    "dedup": {
      "provider": "anthropic",
      "model": "claude-haiku-4"
    },
    "compression": {
      "provider": "ollama",
      "model": "llama3",
      "endpoint": "http://localhost:11434"
    },
    "diagnosis": {
      "provider": "anthropic",
      "model": "claude-haiku-4"
    }
  }
}
```

### Use Cases and Model Selection

| Task | Default Model | Why | Cost (100 ops) | When to Override |
|------|--------------|-----|----------------|------------------|
| **Calibration Evaluation** | Haiku | Structured classification, full context provided | $0.15 | Use Ollama for privacy (free) or GPT-4o-mini for cost ($0.08) |
| **Dedup Checking** | Haiku | Semantic comparison beyond vector similarity | $0.10 | Use Ollama if API budget constrained |
| **Pattern Compression** | Ollama (llama3) | High frequency (every retrieval), summarization task | $0 | Use Haiku if Ollama unavailable or latency critical |
| **Zero-Hit Triage** | Haiku | One-time classification, low cost | $0.01 | - |
| **Error Diagnosis** | Haiku | Pattern matching in logs, infrequent | $0.05 | - |

### Task Details

#### 1. Calibration Evaluation (Primary Use Case)

**Frequency**: 100 samples per calibration run (every 3-6 months)

**Task**: Rate injected patterns as critical/helpful/mentioned/unused given full context (prompt, patterns, response)

**Model Selection Criteria**:
- **Structured output**: Must follow "number:rating" format reliably
- **Classification**: Simple 4-class problem, not generative
- **Full context**: Receives 3-5k tokens (prompt + patterns + response)
- **Not user-facing**: Can tolerate 1-2s latency

**Cost Analysis**:
```
Haiku (default):    $0.0015/eval × 100 = $0.15 per calibration
GPT-4o-mini:        $0.0008/eval × 100 = $0.08 per calibration
Ollama (llama3):    $0/eval × 100 = $0 (+ inference time: ~3hrs total)
Sonnet:             $0.015/eval × 100 = $1.50 per calibration (10× cost)
```

**Privacy Consideration**: Evaluation sees user prompts and responses. For sensitive environments, use Ollama (local inference, zero API calls).

**Implementation**:
```typescript
async function evaluatePatternUsage(
  prompt: string,
  patterns: Pattern[],
  response: string,
  config: ModelConfig
): Promise<Evaluation[]> {
  const evalPrompt = buildEvaluationPrompt(prompt, patterns, response);
  
  const result = await callModel(config.models.evaluation, evalPrompt);
  return parseEvaluationResponse(result);
}
```

#### 2. Dedup Checking (Capture Phase)

**Frequency**: Low (only during manual proposal approval or auto-capture)

**Task**: Determine if proposed pattern is duplicate/distinct/mergeable vs existing similar pattern

**Prompt**:
```
Proposed pattern: <new content>
Existing similar pattern (0.87 similarity): <existing content>

Are these duplicates or meaningfully different?
Reply: duplicate | distinct | merge

If merge: suggest combined version (preserve both insights).
```

**Why LLM over vector similarity alone**: Catches semantic duplicates that vector distance misses (paraphrases, different examples, same underlying rule).

**Cost**: ~$0.001 per check, amortized over ~10-20 proposals/month = $0.01-0.02/month

**Model Choice**: Haiku (default) or Ollama (free, slightly slower)

#### 3. Pattern Compression (Retrieval Phase) — Defer to v2+

**Frequency**: High (every retrieval where patterns >300 tokens)

**Task**: Compress verbose patterns to ~150 tokens preserving core rule, examples, caveats

**Prompt**:
```
Original pattern (420 tokens): <full content>

Compress to ~150 tokens preserving:
- Core rule/concept
- Key examples
- Critical caveats

Output compressed version only (no commentary).
```

**Why**: Enables injecting more patterns within token budget. Target: 60% compression (5 patterns @ 250 tokens avg → 3k total vs 5k uncompressed).

**Risk**: Lossy compression may drop nuance. Measure quality impact during calibration (compare compressed vs full on same sample).

**Cost** (if using Haiku at ~850 retrievals/month):
```
850 retrievals × $0.002/compression = $1.70/month
```

**Latency reality check**: Ollama inference is often 3-5+ seconds per call (model/hardware dependent). At 850 retrievals/month × 4s average = **56 hours cumulative inference time**. Even as background task, this delays context availability and burns CPU constantly.

**Recommendation**: **Defer to v2+, validate need first.** Alternatives that avoid per-retrieval cost:
1. **Write tighter patterns** — most patterns shouldn't need 400+ tokens
2. **Cache compressed versions** — compress once at rebuild time, serve compressed version
3. **Pre-compute summaries** — store both full + compressed in ChromaDB metadata

If on-demand compression is truly needed: use **Haiku** (200ms, predictable) not Ollama (cheap but 10-20× slower for high-frequency task).

**Model Choice** (if implemented): Haiku with aggressive caching, not Ollama

#### 4. Zero-Hit Pattern Triage (Maintenance)

**Frequency**: Rare (quarterly, per stale pattern)

**Task**: Classify why a pattern was never retrieved: stale | niche | obsolete | mislabeled

**Prompt**:
```
Pattern: mobile-gestures.md (never retrieved in 90 days)
Content: <pattern>
Recent corpus topics: test automation, web testing, CI/CD, BrowserStack

Assessment: stale | niche | obsolete | mislabeled

Explanation: <why>
If stale: suggest update
If mislabeled: suggest better filename/category
```

**Value**: Smarter pruning than blunt "zero hits → delete". Distinguishes niche-but-valid from truly obsolete.

**Cost**: Batch operation (~5-15 patterns) = $0.01 total

**Model Choice**: Haiku (sufficient, cheap)

#### 5. Error Diagnosis (Troubleshooting)

**Frequency**: On-demand (`/context-doctor`)

**Task**: Diagnose errors from logs + recent changes + system state

**Prompt**:
```
Error: Query timeout (2400ms)
Recent changes: Added 40 new docs 3 days ago
System: ChromaDB file mode, nomic embeddings, 142 chunks
Logs: <relevant lines>

Likely cause? Reply: diagnosis + fix suggestion
```

**Value**: Faster debugging, surfaces non-obvious correlations (e.g., rebuild after big doc add caused index bloat)

**Cost**: $0.005 per diagnosis, rare usage

**Model Choice**: Haiku (pattern matching, sufficient for log analysis)

### Model Provider Abstraction

```typescript
interface ModelProvider {
  call(prompt: string, options: CallOptions): Promise<string>;
}

class AnthropicProvider implements ModelProvider {
  async call(prompt: string, options: CallOptions): Promise<string> {
    const response = await anthropic.messages.create({
      model: options.model || 'claude-haiku-4',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: options.maxTokens || 1024
    });
    return response.content[0].text;
  }
}

class OllamaProvider implements ModelProvider {
  async call(prompt: string, options: CallOptions): Promise<string> {
    const response = await fetch(`${options.endpoint}/api/generate`, {
      method: 'POST',
      body: JSON.stringify({
        model: options.model || 'llama3',
        prompt: prompt,
        stream: false
      })
    });
    const data = await response.json();
    return data.response;
  }
}

// Factory
function getProvider(config: ModelConfig): ModelProvider {
  switch (config.provider) {
    case 'anthropic': return new AnthropicProvider(config);
    case 'openai': return new OpenAIProvider(config);
    case 'ollama': return new OllamaProvider(config);
    case 'custom': return new CustomProvider(config);
    default: throw new Error(`Unknown provider: ${config.provider}`);
  }
}
```

### Auto-Detection and Fallback

```typescript
async function detectAvailableModels(): Promise<ModelOption[]> {
  const available: ModelOption[] = [];
  
  // Always offer Anthropic if API key present
  if (process.env.ANTHROPIC_API_KEY) {
    available.push({
      provider: 'anthropic',
      model: 'claude-haiku-4',
      cost: 0.0015,
      note: 'Fast, high quality, API call'
    });
  }
  
  // Check for local Ollama
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const { models } = await response.json();
      available.push({
        provider: 'ollama',
        model: models[0]?.name || 'llama3',
        cost: 0,
        note: 'Free, private, slower (~2s per eval)'
      });
    }
  } catch {}
  
  // Check for OpenAI
  if (process.env.OPENAI_API_KEY) {
    available.push({
      provider: 'openai',
      model: 'gpt-4o-mini',
      cost: 0.0008,
      note: 'Cheap, fast, API call'
    });
  }
  
  return available;
}
```

### Cost vs Privacy vs Latency Trade-offs

| Dimension | Anthropic (Haiku) | OpenAI (gpt-4o-mini) | Ollama (llama3) |
|-----------|-------------------|----------------------|-----------------|
| **Cost (100 evals)** | $0.15 | $0.08 | $0 (electricity only) |
| **Privacy** | API call (prompt/response sent) | API call | Fully local |
| **Latency (per call)** | ~200ms | ~150ms | ~3-5s (hardware dependent) |
| **Quality** | High | High | Good |
| **Availability** | Requires API key + internet | Requires API key + internet | Requires Ollama installed |
| **Best For** | Default (balanced) | Cost-sensitive | Privacy-sensitive, low-frequency |

**Ollama Latency Reality**: Advertised "~500ms" assumes powerful hardware (M3 Max, RTX 4090). On typical hardware (M1, older GPUs), expect 3-5+ seconds per inference. This makes Ollama **acceptable for low-frequency background tasks** (calibration: 100 calls over 2 weeks = 5-8 minutes total) but **impractical for high-frequency tasks** (compression: 850 calls/month = 42-70 hours cumulative).

### Configuration UI Example

When starting calibration:

```
/context-calibrate --start

Evaluation Model Selection:

Available models (auto-detected):
  1. claude-haiku-4 (default, recommended)
     • Cost: $0.15 total (100 evals)
     • Latency: ~200ms per eval
     • Privacy: API call

  2. ollama:llama3 (detected at localhost:11434)
     • Cost: Free
     • Latency: ~2s per eval (~3hrs total inference time)
     • Privacy: Fully local (no API calls)

  3. gpt-4o-mini
     • Cost: $0.08 total
     • Latency: ~150ms per eval
     • Privacy: API call

Select model [1]: 2

✓ Using ollama:llama3 for evaluation
  • Free (local inference, ~0.5 kWh total)
  • Private (no prompts/responses sent to API)
  • Expected duration: ~3 hours inference time over 1-2 weeks

Calibration started. Progress: /context-calibrate --status
```

### Implementation Priorities

**v1** (ship with):
- Haiku for calibration evaluation (default)
- Ollama auto-detection + fallback
- Single provider abstraction

**v2** (add later):
- Dedup checking with configurable model
- Pattern compression (optional, measure benefit first)
- Custom endpoint support for enterprise (e.g., internal LLM API)

**v3** (future):
- Zero-hit triage
- Error diagnosis with LLM

**Rationale**: Ship v1 with calibration quality measurement (solves Opus critique). Add other tasks once proven valuable via manual testing.

## Retrieval Frequency Tracking

Hit count is a first-class metadata field, updated on every retrieval by the daemon.

```typescript
// After query results are returned
for (const match of topMatches) {
  await collection.update({
    ids: [match.id],
    metadatas: [
      {
        ...match.metadata,
        hit_count: (match.metadata.hit_count || 0) + 1,
        last_hit: new Date().toISOString(),
      },
    ],
  });
}
```

**Uses:**

- **Re-ranking**: frequency boost factor alongside sourceWeight, typeBoost, freshnessDecay
- **Calibration dashboard**: `/context-debug` surfaces zero-hit patterns older than N sessions
- **Proposal scoring**: high-frequency pattern in retrieved set strengthens `[similar: x]` signal
- **Auto-save quality control**: post-auto-save audit identifies noise (captured but never retrieved)

**Bias warning**: Frequency favors general memories over specific ones. A broad logging pattern gets retrieved constantly; a narrow edge-case workaround gets retrieved rarely but may be exactly what is needed. Use frequency as one re-ranking factor, not the dominant one.

## Re-ranking

Lightweight post-retrieval scoring — no LLM calls, no cross-encoders, <5ms overhead.

```typescript
const sourceWeights = {
  projectMemory: 1.0,
  projectDocs: 0.9,
  parentMemory: 0.7,
  userMemory: 0.8,
  userDocs: 0.7,
};

const typeBoosts = {
  feedback: 1.2, // Actionable patterns — highest priority
  reference: 1.0,
  decision: 0.9,
  project: 0.8,
};

function rerank(results: SearchResult[]): SearchResult[] {
  return results
    .map((r) => ({
      ...r,
      finalScore:
        r.similarity *
        sourceWeights[r.metadata.source] *
        typeBoosts[r.metadata.type] *
        freshnessDecay(r.metadata.last_embedded) *
        hitCountBoost(r.metadata.hit_count),
    }))
    .sort((a, b) => b.finalScore - a.finalScore);
}

function hitCountBoost(count: number): number {
  // Logarithmic — diminishing returns, caps around 1.3
  return 1 + Math.log10(1 + (count || 0)) * 0.15;
}
```

## Injection Floor: Don't Inject Just to Inject

**The single most important quality control in the system.** Vector similarity always returns a top-K — there is no natural zero. A cosine query for "fix this typo" will still return a "best match" at 0.43 and, without a floor, inject it. Irrelevant injected context is not free: it dilutes attention and can actively degrade the response. **Some prompts should receive nothing.**

This replaces a property we currently get for free from keyword search. Keyword matching is self-gating — no lexical match means no injection, so low-signal prompts naturally receive nothing. Embeddings remove that safety: confident-but-wrong top-K results are the default failure mode. The floor restores the "inject nothing" behavior that keyword retrieval provided implicitly.

```typescript
const reranked = rerank(matches);
const keep = reranked.filter((m) => m.similarity >= injectionFloor);

if (keep.length === 0) {
  logNoInject({ prompt_hash, best_score: reranked[0]?.similarity ?? 0, reason: 'below_floor' });
  return { continue: true }; // Inject nothing — this is a success, not a failure
}
```

**No-inject is a first-class outcome.** It is logged as its own event (`reason: below_floor, best_score: 0.43`), surfaced in `/context-status` ("injected 62% of prompts, skipped 38%"), and used to tune the floor. A high skip rate is not a bug — it is the system correctly declining to add noise.

**The floor is model-dependent — calibrate it empirically, do not hardcode 0.7.** Different embedding models have different similarity distributions. The right way to set it:

1. Embed the existing corpus.
2. Replay real historical prompts through retrieval, logging every similarity score.
3. For each, judge whether that injection would have been wanted.
4. The floor is the score below which "wanted it" essentially never happens.

This is distinct from `similarityThreshold` as a ranking filter. The floor answers "inject anything at all?"; ranking answers "in what order?". They are tuned against different questions and should not share a value.

**Floor vs. ranking vs. dedup thresholds** (three independent knobs):

| Threshold             | Question it answers                | Failure if wrong                           |
| --------------------- | ---------------------------------- | ------------------------------------------ |
| `injectionFloor`      | Inject anything at all?            | Too low → noise on every prompt            |
| `similarityThreshold` | Which of the kept results, ranked? | Too high → relevant patterns dropped       |
| `dedupThreshold`      | Is this a duplicate at creation?   | Too low → corpus fragments into near-dupes |

## Staleness Handling

Staleness is a first-class health metric, not an implicit side effect.

```typescript
interface EmbeddingMetadata {
  content_hash: string; // SHA-256 of file content
  last_embedded: string; // ISO timestamp
  file_modified: string; // File mtime
  embedding_model: string; // Model used for this embedding
  hit_count: number;
  last_hit: string | null;
}

async function auditStaleness(): Promise<StaleReport> {
  const allDocs = await collection.get();
  const stale = allDocs.filter((doc) => {
    const currentHash = hashFile(doc.metadata.parent_file || doc.id);
    return currentHash !== doc.metadata.content_hash;
  });

  return {
    total: allDocs.length,
    stale: stale.length,
    files: stale.map((d) => d.metadata.parent_file || d.id),
  };
}
```

**Repair strategies:**

- On-demand: detect stale on query, re-embed before returning
- Batch: `/rebuild-embeddings --stale-only`
- Automatic: PostToolUse hook on Write/Edit to context or doc files

## Injection Format

Standardized Context Block schema for consistent, scannable output:

```markdown
## 📝 Relevant Context (3 found)

### [Framework] Use Logger Helper (similarity: 0.92, hits: 14)

**Source**: `.claude/context/framework/feedback_use_logger_helper.md`
**Type**: feedback | **Updated**: 2026-05-15

> Always use `getLogger()` from `~/helpers/logger` instead of `console.log`.
> This ensures consistent log formatting...

[Full content: 245 tokens]

---

### [Testing] Test Session Artifacts (similarity: 0.78, hits: 3)

**Source**: `.claude/context/testing/reference_test_session_artifacts.md`
**Type**: reference | **Updated**: 2026-04-20

> Session artifacts are stored in `results/sessions/{sessionId}/`...

---

_Context retrieval: 80ms | Injected: 1,240 tokens | Sources: projectContext(2), userContext(1)_
```

Showing hit count inline lets you evaluate retrieval quality during calibration — frequently retrieved patterns appearing in results is a positive signal; zero-hit patterns appearing suggests threshold needs tuning.

## Context Compression

Retrieved context patterns are compressed before injection to reduce token usage while preserving actionable content.

### Strategy: Lean-ctx Style Pattern Extraction

Pattern-based reduction, similar to lean-ctx's shell output compression:

- Keep rules, patterns, actionable guidance
- Strip verbose examples, redundant explanations, filler
- Preserve code snippets (they're already concise)
- Maintain structure (headers, lists)

**Compression is deterministic and fast** — no LLM calls, <5ms overhead per context.

### Threshold-Based Activation

```json
{
  "retrieval": {
    "compression": {
      "enabled": true,
      "mode": "auto", // "auto" | "always" | "never"
      "threshold": 300, // tokens — compress if pattern exceeds this
      "strategy": "pattern" // "pattern" | "excerpt" | "llm"
    }
  }
}
```

**Modes:**

- `auto` (default): Compress only if pattern >threshold tokens
- `always`: Compress all retrieved patterns regardless of size
- `never`: Inject full content (assumes patterns are already concise)

**Strategies:**

- `pattern` (default): Lean-ctx style pattern extraction
  - For `feedback` type: Keep rules, strip examples
  - For `reference` type: Keep paths/commands, strip explanations
  - For `doc-chunk`: Already chunked, light compression only
  - For `doc-overview`: Excerpt first 200 tokens (low priority type)
- `excerpt`: Simple truncation to first N tokens + "... (see full: path)"
- `llm`: Haiku-based summarization (high quality, adds latency — v2 feature)

### Example: Before/After Compression

**Before (450 tokens):**

````markdown
### [Framework] Use Logger Helper

**Why:** Console.log doesn't provide structured logging, makes it hard to filter,
and doesn't integrate with our log aggregation pipeline. Using getLogger()
ensures consistent formatting across the codebase and makes debugging easier.

**How to apply:**

1. Import the logger helper at the top of your file
2. Create a logger instance with a descriptive name
3. Use appropriate log levels (debug, info, warn, error)

**Example:**

```typescript
import { getLogger } from '~/helpers/logger';
const logger = getLogger('TestRunner');

// Instead of console.log('Starting test')
logger.info('Starting test', { testId: test.id });

// Instead of console.error(error)
logger.error('Test failed', { error: error.message, stack: error.stack });
```
````

**Benefits:**

- Structured JSON output for easy parsing
- Automatic timestamp and context injection
- Integration with Datadog log aggregation
  ...

````

**After pattern compression (180 tokens):**
```markdown
### [Framework] Use Logger Helper (compressed)

**Rule:** Use `getLogger()` from `~/helpers/logger` instead of `console.log`

**Pattern:**
```typescript
import { getLogger } from '~/helpers/logger';
const logger = getLogger('ComponentName');
logger.info('message', { context });
logger.error('message', { error: err.message });
````

**Why:** Structured logging, Datadog integration, consistent formatting

[Full context: .claude/context/framework/feedback_use_logger_helper.md]

````

**Token savings: 60% reduction** while preserving actionable content.

### Implementation

Compression happens in the daemon after re-ranking, before injection formatting:

```typescript
function compressContext(context: Context, config: CompressionConfig): string {
  if (!config.enabled) return context.document;

  const tokenCount = estimateTokens(context.document);

  if (config.mode === 'never' ||
      (config.mode === 'auto' && tokenCount < config.threshold)) {
    return context.document;  // Skip compression
  }

  switch (config.strategy) {
    case 'pattern':
      return extractPatterns(context.document, context.metadata.type);
    case 'excerpt':
      return excerptContext(context.document, config.threshold);
    case 'llm':
      return await summarizeWithHaiku(context.document);  // v2
  }
}

function extractPatterns(content: string, type: string): string {
  // Lean-ctx style pattern extraction
  const patterns = {
    feedback: [
      /\*\*Rule:\*\*.+/g,           // Keep rules
      /\*\*Pattern:\*\*.+/g,        // Keep patterns
      /```[\s\S]*?```/g,            // Keep code blocks
      /^(#+\s.+)$/gm                // Keep headers
    ],
    reference: [
      /\*\*Path:\*\*.+/g,
      /\*\*Command:\*\*.+/g,
      /```[\s\S]*?```/g
    ]
  };

  // Extract matching patterns, strip verbose prose
  // Return compressed version with "[Full context: path]" footer
}
````

### Compression Metrics in `/context-debug`

```
Compression Stats (last 30 sessions):
  Patterns compressed: 42 / 90 (46.7%)
  Avg compression ratio: 62% reduction
  Token savings: 18,340 tokens total
  Compression overhead: <5ms avg
```

This helps validate that compression is working and quantifies the token savings.

## Plugin Structure

### Option A: Claude Plugin (Recommended)

```
claude-contextus/
├── plugin.json
├── package.json
├── daemon/
│   └── server.js               # Persistent HTTP daemon
├── scripts/
│   ├── embed-contexts.js       # Build/rebuild embeddings
│   ├── query-hook.js           # UserPromptSubmit — thin HTTP client
│   ├── awareness-hook.js       # Proposal footer injection
│   └── watch-contexts.js       # PostToolUse — thin HTTP client
├── hooks/
│   └── hooks.json
├── skills/
│   ├── rebuild-embeddings/SKILL.md
│   ├── context-search/SKILL.md
│   ├── context-debug/SKILL.md   # Calibration dashboard
│   ├── create-context/SKILL.md
│   ├── create-doc/SKILL.md
│   ├── add-patterns/SKILL.md
│   ├── audit-context/SKILL.md
│   └── update-context-index/SKILL.md
├── lib/
│   ├── embedder.js
│   ├── chroma-client.js
│   ├── context-loader.js
│   ├── context-creator.js
│   ├── context-validator.js
│   ├── deduplicator.js
│   ├── reranker.js
│   ├── staleness.js
│   └── index-updater.js
├── templates/
│   ├── context-template.md
│   └── doc-template.md
└── README.md
```

### plugin.json

```json
{
  "name": "claude-contextus",
  "version": "1.0.0",
  "description": "Context management: proactive capture + automatic semantic retrieval via vector embeddings",
  "author": "Anthony Dawson",
  "engines": {
    "claude": ">=1.0.0",
    "node": ">=18.0.0"
  },
  "dependencies": {
    "chromadb": "^1.8.0",
    "@xenova/transformers": "^2.6.0"
  },
  "config": {
    "enabled": true,
    "chroma": {
      "mode": "file",
      "path": "~/.contextus/data/{project-name}"
    },
    "embedding": {
      "provider": "transformers",
      "model": "nomic-ai/nomic-embed-text-v1.5",
      "dimensions": 768,
      "ollama_model": "nomic-embed-text",
      "batchSize": 32
    },
    "retrieval": {
      "topK": 5,
      "similarityThreshold": 0.7,
      "dedupThreshold": 0.85,
      "maxTokens": 3000
    },
    "capture": {
      "mode": "propose"
    },
    "autoRebuild": true
  },
  "hooks": "hooks/hooks.json",
  "skills": [
    "skills/rebuild-embeddings",
    "skills/context-search",
    "skills/context-debug",
    "skills/create-context",
    "skills/create-doc",
    "skills/add-patterns",
    "skills/audit-context",
    "skills/update-context-index"
  ]
}
```

**Note**: `retrieval.similarityThreshold` (query) and `retrieval.dedupThreshold` (creation) are tuned independently. A pattern “close enough to skip creation” should not automatically be “close enough to always retrieve.”

### Hooks Configuration

```json
{
  "SessionStart": [
    {
      "hooks": [
        {
          "command": "node $PLUGIN_PATH/scripts/session-start-hook.js",
          "type": "command"
        }
      ],
      "matcher": ".*"
    }
  ],
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "command": "node $PLUGIN_PATH/scripts/query-hook.js",
          "type": "command"
        }
      ],
      "matcher": ".*"
    },
    {
      "hooks": [
        {
          "command": "node $PLUGIN_PATH/scripts/awareness-hook.js",
          "type": "command"
        }
      ],
      "matcher": ".*"
    }
  ],
  "PostToolUse": [
    {
      "hooks": [
        {
          "command": "node $PLUGIN_PATH/scripts/watch-memories.js",
          "type": "command"
        }
      ],
      "matcher": "Write|Edit"
    }
  ]
}
```

## Implementation Plan

### Phase 1: Embedding Pipeline

**Goal**: Populate Chroma with all context patterns and doc embeddings

```javascript
async function embedContexts({ rebuild = false, verbose = false }) {
  const EMBEDDING_MODEL = loadConfig().embedding.model; // From config, not hardcoded

  const client = new ChromaClient({ path: resolveDBPath() });
  const collection = await client.getOrCreateCollection('contextus', {
    metadata: {
      embeddingModel: EMBEDDING_MODEL,
      dimensions: loadConfig().embedding.dimensions,
      createdAt: new Date().toISOString(),
    },
  });

  // Validate model consistency
  const meta = await collection.metadata();
  if (meta.embeddingModel && meta.embeddingModel !== EMBEDDING_MODEL) {
    throw new Error(
      `Collection built with ${meta.embeddingModel}, config specifies ${EMBEDDING_MODEL}. ` +
        `Run /rebuild-embeddings to regenerate.`
    );
  }

  // Validate dimensions match
  if (meta.dimensions && meta.dimensions !== loadConfig().embedding.dimensions) {
    throw new Error(
      `Dimension mismatch: collection has ${meta.dimensions}, ` +
        `config specifies ${loadConfig().embedding.dimensions}. ` +
        `Run /rebuild-embeddings to regenerate.`
    );
  }

  const sources = await getAllReadSources();
  for (const source of sources) {
    await embedSource(source, collection, { rebuild, verbose });
  }
}
```

### Phase 2: Daemon + HTTP Architecture

**Rationale**: `@xenova/transformers` model loading takes 2-5 seconds due to WASM initialization. A fresh Node process per hook invocation makes this unavoidable. Daemon loads model once, all hooks are thin HTTP clients.

```
SessionStart hook (JS script)
  → ensureDaemonRunning() — polls /health until modelLoaded: true
  → daemon loads embedding model (nomic default), initializes Chroma client

UserPromptSubmit hook (thin HTTP client)
  → POST { prompt, project } to localhost:37800/query
  → return { additionalContext: ... } from response

PostToolUse hook (Write|Edit, thin HTTP client)
  → POST { file, content, project } to localhost:37800/notify
  → daemon triggers incremental re-embed if context/doc file changed
```

**Session Start Hook** (JS, not bash — cross-platform):

```javascript
// scripts/session-start-hook.js
async function sessionStartHook() {
  const wasRunning = await ensureDaemonRunning();
  if (!wasRunning) {
    // Poll until model is warm — don't assume fixed sleep duration
    let attempts = 0;
    while (attempts < 20) {
      await sleep(500);
      try {
        const res = await fetch('http://localhost:37800/health');
        const body = await res.json();
        if (body.modelLoaded) break;
      } catch {
        /* still starting */
      }
      attempts++;
    }
  }
  return { continue: true };
}
```

**Health Endpoint:**

```javascript
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    modelLoaded: embedder !== null,
    chromaConnected: await chromaClient.heartbeat(),
    embeddingModel: DAEMON_MODEL,
  });
});
```

### Daemon Lifecycle

**Single shared daemon across all projects** — model loaded once, project isolation via request parameter.

```
~/.contextus/
  data/
    automation/          # File-based ChromaDB per project
    backend/
  runtime/
    daemon.pid
    daemon.port          # Fixed: 37800
```

**API:**

```javascript
POST http://localhost:37800/query
{ "project": "automation", "prompt": "How do I debug tests?" }

POST http://localhost:37800/notify
{ "project": "automation", "file": ".claude/context/testing/feedback_new.md" }

GET  http://localhost:37800/health
```

**Crash Recovery** (fire-and-forget):

```javascript
async function ensureDaemonRunning(): Promise<boolean> {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'));
    try {
      process.kill(pid, 0);  // Check if process exists
      const res = await fetch('http://localhost:37800/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) return true;
    } catch { /* stale PID or unhealthy */ }
    fs.unlinkSync(PID_PATH);
  }

  spawn('node', [DAEMON_PATH], { detached: true, stdio: 'ignore' }).unref();
  return false;
}

// In query hook: if daemon unreachable, restart in background, proceed without context
async function queryHook(prompt: string) {
  try {
    const res = await fetch('http://localhost:37800/query', {
      method: 'POST',
      body: JSON.stringify({ prompt, project: getProjectName() }),
      signal: AbortSignal.timeout(5000)
    });
    return await res.json();
  } catch {
    ensureDaemonRunning();  // Fire-and-forget
    return { continue: true };  // Graceful degradation — one missed injection
  }
}
```

**Daemon lifecycle**: Keep warm between sessions (daemon stays alive until machine restart or explicit kill). TTL-based shutdown can be added later if memory usage becomes a concern.

**Per-project model override**: If a project configures a different embedding model, fall back to a dedicated per-project daemon on a different port. Rare edge case — the shared model constraint covers 95% of usage.

### Phase 3: Incremental Updates

PostToolUse hook fires on Write/Edit. If the changed file is in a context or doc source, daemon re-embeds incrementally.

**User context changes propagate to all project DBs:**

```bash
vim ~/.claude/context/feedback_git.md

# File watcher detects change
→ Rebuilding automation: ~/.contextus/data/automation/
→ Rebuilding backend: ~/.contextus/data/backend/
→ ✓ All projects updated (2-3 sec each)
```

### Phase 4: Debugging & Calibration

**`/context-debug` output:**

```
Context Health:
  Total embeddings: 90 (70 patterns, 20 docs)
  Embedding model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
  Stale embeddings: 3 (3.3%)
    - .claude/context/testing/feedback_new_pattern.md
    - docs/setup-guide.md

Retrieval Stats (last 30 sessions):
  Avg similarity of injected patterns: 0.81
  Avg tokens injected: 1,340
  Zero-hit patterns (never retrieved): 8
    - framework/decision_early_architecture.md (captured 45 sessions ago)
    - ...

Proposal Stats:
  Total proposals: 47
  Acted on: 23 (48.9%)
  Ignored: 24 — consider raising awareness threshold or pruning
  Repeated proposals (5+ times, never saved): 3 topics
    - "browserstack-local-tunnel-setup"
    - ...

Config:
  retrieval.similarityThreshold: 0.7
  retrieval.dedupThreshold: 0.85
  capture.mode: propose
  retrieval.topK: 5
```

**Vector Inspector integration:**

```bash
# Point vector-inspector at contextus collection for embedding visualization
vector-inspector ~/.contextus/data/automation contextus
```

Useful for identifying clusters of near-duplicate memories, visualizing coverage gaps, and validating that the embedding model separates your memory categories well.

## Storage & Git Integration

### ChromaDB Location

```
# In project (git-tracked)
.claude/
├── context/             # Source files — committed, team-shared
│   ├── CONTEXT.md
│   ├── sdk/
│   ├── testing/
│   └── framework/
└── settings.json        # Personal config — gitignored

# In user space (not in git)
~/.contextus/
  data/
    {project-name}/      # Per-project ChromaDB instance
      chroma.sqlite3
      index/
  runtime/
    daemon.pid
    daemon.port
```

### Project Name Derivation

1. Git repo name (preferred)
1. Directory basename (fallback)
1. User override via config (edge cases: name collisions)

```json
{
  "chroma": {
    "projectId": "automation-mobile" // Override default
  }
}
```

### First Run

On first session in a project, embeddings build automatically:

```bash
cd automation
# First prompt triggers auto-build
→ Building ~/.contextus/data/automation/
→ Indexing 90 files (70 memories + 20 docs + user memories)
→ ✓ Ready! (~15-20 seconds)
```

## Multi-Source Architecture

### Source Hierarchy

```typescript
const sourceWeights = {
  projectContext: 1.0, // Local patterns (highest priority)
  projectDocs: 0.9, // Local documentation
  userContext: 0.8, // Personal cross-project notes
  parentContext: 0.7, // Parent repo patterns
  userDocs: 0.7,
  custom: 0.7, // Sibling projects, frameworks
};
```

All sources in one collection, single query per prompt. Source isolation via metadata, not separate collections.

### Custom Sources (Read-Only)

Custom sources (parent repos, siblings, frameworks) are read-only for retrieval. Writes always go to `projectContext` or `userContext`.

```bash
# Add custom source
/configure add-source ../.claude/context --label parent

# List sources
/configure list-sources
✓ projectContext: .claude/context (70 files)
✓ projectDocs: docs (20 files)
✓ userContext: ~/.claude/context (12 files)
Total: 102 knowledge files indexed
```

### Auto-Detection

On first plugin load or `/configure discover`, scan parent directories and siblings for `.claude/context/` and prompt to enable.

## Configuration Reference

### Environment Variables

```bash
CONTEXTUS_RAG_ENABLED=true
CONTEXTUS_RAG_CHROMA_PATH=~/.contextus/data      # User space, not project
CONTEXTUS_RAG_TOP_K=5
CONTEXTUS_RAG_SIMILARITY_THRESHOLD=0.7
CONTEXTUS_RAG_DEDUP_THRESHOLD=0.85
CONTEXTUS_RAG_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5
CONTEXTUS_RAG_EMBEDDING_DIMENSIONS=768
CONTEXTUS_RAG_AUTO_REBUILD=true
CONTEXTUS_RAG_CAPTURE_MODE=propose
```

### Per-Project Settings (`.claude/settings.json`)

```json
{
  "claudeContextus": {
    "enabled": true,
    "retrieval": {
      "topK": 5,
      "similarityThreshold": 0.7,
      "dedupThreshold": 0.85
    },
    "capture": {
      "mode": "propose"
    },
    "embedding": {
      "model": "nomic-ai/nomic-embed-text-v1.5",
      "dimensions": 768
    }
  }
}
```

## Pre-Implementation Checklist

Before implementation:

- [ ] **Lock embedding model**: nomic-ai/nomic-embed-text-v1.5 as global default — update all dimension references to 768
- [ ] **A/B benchmark**: nomic vs MiniLM on representative query set before first index commit
- [ ] **Design daemon API contract**: full endpoint specs, request/response shapes
- [ ] **Confirm chunk strategy**: for freeform docs (dual embedding) vs structured patterns (whole or chunk)
- [ ] **Test awareness hook wording** in real sessions with novelty signal format

During implementation:

- [ ] **Add `/health` endpoint** with `modelLoaded` field — session start hook polls this, not sleep()
- [ ] **Implement `ensureDaemonRunning()`** as shared JS utility (SessionStart + crash recovery)
- [ ] **Store embedding model + dimensions** in Chroma metadata at collection creation
- [ ] **Validate model + dimensions** on every query — fail fast with actionable error
- [ ] **Handle chunked results** with breadcrumb deduplication in `formatContextInjection`
- [ ] **Implement hit count tracking** — increment on every retrieval, expose in `/context-debug`
- [ ] **Separate retrieval and dedup thresholds** in config — do not share a value
- [ ] **Wire PostToolUse hook** to daemon `/notify` for incremental re-embed
- [ ] **Add dual embedding path** for freeform docs (doc-overview + doc-chunk types)

## Server Mode (Optional)

For users already running a ChromaDB server:

```json
{
  "chroma": {
    "mode": "server",
    "host": "localhost",
    "port": 8000,
    "collection": "{project-name}-contextus"
  }
}
```

File mode is the default and preferred for most users — no separate server to manage.

## Future Improvements

### Vector Store Abstraction (v2+)

```typescript
interface VectorStore {
  upsert(id: string, embedding: number[], metadata: object): Promise<void>;
  query(embedding: number[], topK: number): Promise<Match[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}
// ChromaStore, PineconeStore, QdrantStore, WeaviateStore, PGVectorStore
```

Low priority — ChromaDB covers the use case. Add when users request specific providers.

### Retrieval Quality Feedback Loop (High Value, v2)

**Concept**: Learn which retrieved patterns are actually useful.

Current footer:

```
Context: used: logger-helper, test-artifacts
Context: propose: new-pattern
```

Track:

- Retrieved: 5 patterns
- Used (mentioned in footer): 2
- Ignored: 3

Over time, this becomes training data:

- Patterns with low use-rate get downweighted in re-ranking
- Patterns frequently retrieved but never used may be too generic
- Use patterns inform similarity threshold calibration

**Implementation**: Store `use_count` alongside `hit_count` in metadata. Exposure without usage = false positive signal.

### Other Potential Improvements

- **Hybrid search**: Combine semantic + keyword for exact term matches
- **Context versioning**: Track changes over time, rollback support
- **Advanced analytics**: Session co-occurrence, topic clustering
- **Multi-language support**: Non-English patterns
- **Collaborative filtering**: “Users who found X useful also found Y useful”
- **Excerpt mode**: Claude requests truncated injection when approaching context limits

## References

- [DESIGN ADDENDUM.md](./DESIGN%20ADDENDUM.md) — Addendum decisions incorporated into this doc
- [Global Memory System](global-memory.md) — Current manual system
- [claude-mem](~/.claude-mem/settings.json) — Companion Chroma observation tracker
- [vector-inspector](https://github.com/anthonypdawson/vector-inspector) — Embedding visualization and debugging

---

**Status**: Core scaffolding complete, implementation in progress

**Owner**: Anthony Dawson

**Priority**: Active
