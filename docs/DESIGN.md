# claude-contextus: Design & Implementation

*Last updated: June 12, 2026*

**Status**: Core scaffolding complete, implementation in progress

**Repository**: <https://github.com/anthonypdawson/claude-contextus> (private)

## Overview

This document describes how to implement automatic semantic retrieval for the `.claude/memory/` system using vector embeddings and Chroma. This upgrades manual index scanning to automatic, meaning-based memory injection.

**Important**: This is a **separate system** from claude-mem. Both use Chroma but serve different purposes:

|Feature            |claude-contextus (this doc)                       |claude-mem                          |
|-------------------|--------------------------------------------------|------------------------------------|
|**Purpose**        |Inject curated `.claude/memory/` patterns         |Track tool use observations         |
|**Source**         |Hand-written markdown files + docs                |Auto-generated from PostToolUse hook|
|**Scope**          |Normative rules/patterns                          |Historical activity log             |
|**Chroma Mode**    |File-based (`~/.claude/contextus/data/{project}/`)|Server-based (`localhost:8000`)     |
|**Version Control**|Source files committed; DB in user space          |Stored in `~/.claude-mem/`          |
|**Config**         |`MEMORY_RAG_*` env vars                           |`CLAUDE_MEM_*` env vars             |
|**Team Sharing**   |Source files yes (git-tracked); DB no             |No (local per-user)                 |

## Key Architectural Decisions

These decisions are settled. Do not re-litigate without strong evidence.

1. **Default embedding model**: `nomic-ai/nomic-embed-text-v1.5` (768 dim, 138MB). Rationale: technical domain vocabulary (Appium, WebdriverIO, BrowserStack), negligible size overhead at target corpus scale (<200 docs), better semantic understanding for technical prose than MiniLM. Model is user-configurable — see Embedding Providers.
1. **Storage location**: ChromaDB in `~/.claude/contextus/data/{project}/` (user space), not git-committed.
1. **Daemon architecture**: Persistent HTTP daemon instead of stateless hooks (solves model warm-up latency).
1. **Daemon lifecycle**: Single shared daemon across all projects (one embedding model loaded once), graceful degradation on crash.
1. **Chunking strategy**: Chunk long docs with breadcrumb injection; freeform human-written docs use dual embedding (whole-doc overview + chunks).
1. **Embedding model validation**: Store model name in collection metadata, validate on query to prevent silent failures. Model change requires full rebuild.
1. **Awareness hook**: Opt-out framing (“omit only if trivial”), separate JS script for cross-platform safety.
1. **Result destructuring**: Correct Chroma parallel array handling (ids/documents/metadatas/distances).
1. **Proactive capture**: The awareness hook handles proactive memory creation. Retrieval quality is what makes captured memories useful. These are complementary, not competing concerns.
1. **Capture modes**: `propose` (default, safe) vs `auto` (autonomous). Use `propose` during calibration; switch to `auto` once thresholds are tuned.
1. **Proposal format**: Footer includes slug + novelty signal derived from injected memories already in context — no extra daemon round trip on UserPromptSubmit.
1. **Retrieval frequency tracking**: Increment hit counter in Chroma metadata on every retrieval. Used for re-ranking and calibration dashboard.
1. **Dedup and retrieval thresholds**: Tuned independently. Dedup threshold (creation) and retrieval threshold (query) serve different purposes and should not share a value.

## The Core Workflow

The system closes two loops:

**Capture loop** (awareness hook → user action → memory file written → PostToolUse triggers incremental re-embed)

**Retrieval loop** (UserPromptSubmit → daemon query → top-k injected into context → Claude responds with relevant memory available)

Retrieval quality directly determines the ROI of everything captured. The `propose` calibration phase is how you develop confidence in the retrieval pipeline before enabling `auto`.

## Calibration Strategy

The path from install to `auto` mode:

1. Run in `propose` mode. Review footer proposals after each session.
1. Use `/memory-debug` as your calibration dashboard — precision, recall, zero-hit memories, stale embeddings.
1. Watch for `[similar: x]` proposals you’d actually want to capture separately → lower dedup threshold.
1. Watch for `[new]` proposals that are obvious duplicates → raise dedup threshold.
1. A/B test nomic vs MiniLM on a fixed query set before committing (at ~90 docs, reindex cost is minutes).
1. Once thresholds feel right, flip to `auto`.

**Note on existing corpus**: Memories written during long single-session workflows may be written for a different use case — they may capture conversational context rather than durable patterns. Retrieval frequency tracking will surface these quickly (zero-hit memories after 20-30 sessions are candidates for rewrite or deletion).

## Proactive Creation & Proposal Scoring

### Capture Modes

Configurable per project in `.claude/settings.json`:

```json
{
  "claudeContextus": {
    "capture": {
      "mode": "propose"  // "propose" | "auto" | "silent"
    }
  }
}
```

- **propose**: Claude appends a footer with the proposed memory slug and novelty signal. User acts or ignores.
- **auto**: Claude writes the memory file directly via PostToolUse. No user action required.
- **silent**: No proposals, no auto-save. Retrieval only.

### Proposal Footer Format

The awareness hook runs on every UserPromptSubmit alongside the query hook. It has visibility into which memories were injected by the query hook.

**Novelty signal is derived from injected context — no extra daemon round trip.**

If Claude is proposing something not represented in the retrieved memories, that is already a novelty signal. If it is similar to something retrieved, the retrieved memory name is the reference.

```
Memory: propose: wdio-element-visibility-workaround [new]
Memory: propose: appium-session-reset [similar: wdio-session-handling]
```

- `[new]` — not represented in retrieved memories for this session
- `[similar: x]` — close to a retrieved memory; consider whether it merits a separate entry

**Weakness**: Retrieval is top-k filtered, so something may exist in the DB but not be retrieved for this prompt. At <200 documents this is an acceptable false positive rate — the user catches it on review.

### Awareness Hook Implementation

Separate JS script to avoid cross-platform shell escaping issues:

```javascript
// scripts/awareness-hook.js
console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    additionalContext:
      "Memory awareness: Unless this response is purely trivial " +
      "(e.g. a one-line answer, yes/no, or acknowledgment), append footer: " +
      "Memory: propose: topic-name [new|similar: x] if ANY new pattern, " +
      "detail, or context was discussed that is not already covered by the " +
      "injected memories above. Omit only if truly nothing reusable was covered."
  }
}));
```

### Rejected Proposals

No confirmation prompt — act or ignore. Passive rejection signal is inferred from proposal frequency vs. capture rate. `/memory-debug` surfaces: “these topics have been proposed 5+ times and never saved — consider raising the threshold or adjusting the awareness prompt.”

**Rejection tracking TTL**: Rejected proposals should have a session window or context-based reset. If new related memories are added, previously-rejected proposals may become valid. Suggest 30-session TTL or reset when related memory changes are detected.

## Current State (Manual)

**How it works now:**

1. `MEMORY.md` index loaded into context (~2-3k tokens)
1. Claude manually scans index to find relevant memories
1. Claude reads individual memory files on-demand
1. Relies on keyword matching in descriptions

**Limitations:**

- Manual discoverability requires scanning 88+ entries
- Limited to keyword matching in descriptions
- No synonym or semantic understanding
- Misses relevant memories if keywords don’t align

## Proposed State (Automatic RAG)

**How it would work:**

1. All memory files + docs embedded into Chroma vector database
1. On every `UserPromptSubmit`, semantic search for top-k relevant memories
1. Inject top 3-5 memory contents directly into context
1. Dynamic relevance: only load what’s needed for this specific prompt

**Benefits:**

- ✅ **Token efficient**: Load ~2-3k tokens instead of scanning 88-entry index
- ✅ **Semantic matching**: “How do I debug?” → matches Logger Helper memory
- ✅ **Synonym-aware**: “print”, “log”, “console” all match
- ✅ **Scales**: Can grow to 200+ memories without context pressure
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
│  4. Inject top-k memory contents into context           │
│  5. Awareness hook: propose footer from injected set    │
│  6. Claude responds with relevant memory available      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Chroma Database                       │
│                                                         │
│  Collection: "contextus"                                │
│    - Documents (one per memory file / chunk)            │
│    - Metadata: file_path, category, type, source,       │
│                hit_count, last_hit, content_hash,       │
│                embedding_model                          │
│    - Embeddings: 768-dimensional (nomic default)        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Embedding Pipeline                    │
│                                                         │
│  Initial: Embed all .claude/memory/**/*.md + docs/      │
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
Read top 3 memory files, format injection block
   ↓
Inject into context before Claude responds
   ↓
Claude: "Use getLogger() from ~/helpers/logger..."
   ↓
Awareness hook: "framework/feedback_use_logger_helper already injected
 → propose only if discussing something new"
```

## Document Chunking Strategy

**Decision**: Chunk longer documents to avoid truncation. Standard memories are typically short enough to embed whole. Human-written freeform docs use dual embedding.

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

- Standard memory files (<500 tokens) — embed whole
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
    type: "doc-chunk",                    // or "doc-overview", "memory"
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

1. **Global default model** in `~/.claude/contextus/config.json`, used by all projects
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

### Performance Characteristics

|Provider                |Initial Index (200 files)|Query |Offline|Quality|
|------------------------|-------------------------|------|-------|-------|
|Transformers.js (nomic) |~30s                     |~80ms |✅ Yes  |Better |
|Transformers.js (MiniLM)|~20s                     |~55ms |✅ Yes  |Good   |
|Ollama                  |~30s                     |~100ms|✅ Yes* |Better |
|Claude Semantic         |N/A                      |2-5s  |❌ No   |Good   |
|Keyword                 |N/A                      |10ms  |✅ Yes  |Poor   |

*Requires Ollama running locally

## Retrieval Frequency Tracking

Hit count is a first-class metadata field, updated on every retrieval by the daemon.

```typescript
// After query results are returned
for (const match of topMatches) {
  await collection.update({
    ids: [match.id],
    metadatas: [{
      ...match.metadata,
      hit_count: (match.metadata.hit_count || 0) + 1,
      last_hit: new Date().toISOString()
    }]
  });
}
```

**Uses:**

- **Re-ranking**: frequency boost factor alongside sourceWeight, typeBoost, freshnessDecay
- **Calibration dashboard**: `/memory-debug` surfaces zero-hit memories older than N sessions
- **Proposal scoring**: high-frequency memory in retrieved set strengthens `[similar: x]` signal
- **Auto-save quality control**: post-auto-save audit identifies noise (captured but never retrieved)

**Bias warning**: Frequency favors general memories over specific ones. A broad logging pattern gets retrieved constantly; a narrow edge-case workaround gets retrieved rarely but may be exactly what is needed. Use frequency as one re-ranking factor, not the dominant one.

## Re-ranking

Lightweight post-retrieval scoring — no LLM calls, no cross-encoders, <5ms overhead.

```typescript
const sourceWeights = {
  'projectMemory': 1.0,
  'projectDocs': 0.9,
  'parentMemory': 0.7,
  'userMemory': 0.8,
  'userDocs': 0.7
};

const typeBoosts = {
  'feedback': 1.2,    // Actionable patterns — highest priority
  'reference': 1.0,
  'decision': 0.9,
  'project': 0.8
};

function rerank(results: SearchResult[]): SearchResult[] {
  return results.map(r => ({
    ...r,
    finalScore: r.similarity
      * sourceWeights[r.metadata.source]
      * typeBoosts[r.metadata.type]
      * freshnessDecay(r.metadata.last_embedded)
      * hitCountBoost(r.metadata.hit_count)
  })).sort((a, b) => b.finalScore - a.finalScore);
}

function hitCountBoost(count: number): number {
  // Logarithmic — diminishing returns, caps around 1.3
  return 1 + Math.log10(1 + (count || 0)) * 0.15;
}
```

## Staleness Handling

Staleness is a first-class health metric, not an implicit side effect.

```typescript
interface EmbeddingMetadata {
  content_hash: string;       // SHA-256 of file content
  last_embedded: string;      // ISO timestamp
  file_modified: string;      // File mtime
  embedding_model: string;    // Model used for this embedding
  hit_count: number;
  last_hit: string | null;
}

async function auditStaleness(): Promise<StaleReport> {
  const allDocs = await collection.get();
  const stale = allDocs.filter(doc => {
    const currentHash = hashFile(doc.metadata.parent_file || doc.id);
    return currentHash !== doc.metadata.content_hash;
  });

  return {
    total: allDocs.length,
    stale: stale.length,
    files: stale.map(d => d.metadata.parent_file || d.id)
  };
}
```

**Repair strategies:**

- On-demand: detect stale on query, re-embed before returning
- Batch: `/rebuild-embeddings --stale-only`
- Automatic: PostToolUse hook on Write/Edit to memory or doc files

## Injection Format

Standardized Memory Block schema for consistent, scannable output:

```markdown
## 📝 Relevant Memories (3 found)

### [Framework] Use Logger Helper (similarity: 0.92, hits: 14)
**Source**: `.claude/memory/framework/feedback_use_logger_helper.md`
**Type**: feedback | **Updated**: 2026-05-15

> Always use `getLogger()` from `~/helpers/logger` instead of `console.log`.
> This ensures consistent log formatting...

[Full content: 245 tokens]

---

### [Testing] Test Session Artifacts (similarity: 0.78, hits: 3)
**Source**: `.claude/memory/testing/reference_test_session_artifacts.md`
**Type**: reference | **Updated**: 2026-04-20

> Session artifacts are stored in `results/sessions/{sessionId}/`...

---

_Memory retrieval: 80ms | Injected: 1,240 tokens | Sources: projectMemory(2), userMemory(1)_
```

Showing hit count inline lets you evaluate retrieval quality during calibration — frequently retrieved memories appearing in results is a positive signal; zero-hit memories appearing suggests threshold needs tuning.

## Plugin Structure

### Option A: Claude Plugin (Recommended)

```
claude-contextus/
├── plugin.json
├── package.json
├── daemon/
│   └── server.js               # Persistent HTTP daemon
├── scripts/
│   ├── embed-memories.js       # Build/rebuild embeddings
│   ├── query-hook.js           # UserPromptSubmit — thin HTTP client
│   ├── awareness-hook.js       # Proposal footer injection
│   └── watch-memories.js       # PostToolUse — thin HTTP client
├── hooks/
│   └── hooks.json
├── skills/
│   ├── rebuild-embeddings/SKILL.md
│   ├── memory-search/SKILL.md
│   ├── memory-debug/SKILL.md   # Calibration dashboard
│   ├── create-memory/SKILL.md
│   ├── create-doc/SKILL.md
│   ├── add-patterns/SKILL.md
│   ├── audit-memory/SKILL.md
│   └── update-memory-index/SKILL.md
├── lib/
│   ├── embedder.js
│   ├── chroma-client.js
│   ├── memory-loader.js
│   ├── memory-creator.js
│   ├── memory-validator.js
│   ├── deduplicator.js
│   ├── reranker.js
│   ├── staleness.js
│   └── index-updater.js
├── templates/
│   ├── memory-template.md
│   └── doc-template.md
└── README.md
```

### plugin.json

```json
{
  "name": "claude-contextus",
  "version": "1.0.0",
  "description": "Memory management: proactive capture + automatic semantic retrieval via vector embeddings",
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
      "path": "~/.claude/contextus/data/{project-name}"
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
    "skills/memory-search",
    "skills/memory-debug",
    "skills/create-memory",
    "skills/create-doc",
    "skills/add-patterns",
    "skills/audit-memory",
    "skills/update-memory-index"
  ]
}
```

**Note**: `retrieval.similarityThreshold` (query) and `retrieval.dedupThreshold` (creation) are tuned independently. A memory “close enough to skip creation” should not automatically be “close enough to always retrieve.”

### Hooks Configuration

```json
{
  "SessionStart": [{
    "hooks": [{
      "command": "node $PLUGIN_PATH/scripts/session-start-hook.js",
      "type": "command"
    }],
    "matcher": ".*"
  }],
  "UserPromptSubmit": [
    {
      "hooks": [{
        "command": "node $PLUGIN_PATH/scripts/query-hook.js",
        "type": "command"
      }],
      "matcher": ".*"
    },
    {
      "hooks": [{
        "command": "node $PLUGIN_PATH/scripts/awareness-hook.js",
        "type": "command"
      }],
      "matcher": ".*"
    }
  ],
  "PostToolUse": [{
    "hooks": [{
      "command": "node $PLUGIN_PATH/scripts/watch-memories.js",
      "type": "command"
    }],
    "matcher": "Write|Edit"
  }]
}
```

## Implementation Plan

### Phase 1: Embedding Pipeline

**Goal**: Populate Chroma with all memory and doc embeddings

```javascript
async function embedMemories({ rebuild = false, verbose = false }) {
  const EMBEDDING_MODEL = loadConfig().embedding.model;  // From config, not hardcoded

  const client = new ChromaClient({ path: resolveDBPath() });
  const collection = await client.getOrCreateCollection('contextus', {
    metadata: {
      embeddingModel: EMBEDDING_MODEL,
      dimensions: loadConfig().embedding.dimensions,
      createdAt: new Date().toISOString()
    }
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
  → daemon triggers incremental re-embed if memory/doc file changed
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
      } catch { /* still starting */ }
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
    embeddingModel: DAEMON_MODEL
  });
});
```

### Daemon Lifecycle

**Single shared daemon across all projects** — model loaded once, project isolation via request parameter.

```
~/.claude/contextus/
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
{ "project": "automation", "file": ".claude/memory/testing/feedback_new.md" }

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

PostToolUse hook fires on Write/Edit. If the changed file is in a memory or doc source, daemon re-embeds incrementally.

**User memory changes propagate to all project DBs:**

```bash
vim ~/.claude/memory/feedback_git.md

# File watcher detects change
→ Rebuilding automation: ~/.claude/contextus/data/automation/
→ Rebuilding backend: ~/.claude/contextus/data/backend/
→ ✓ All projects updated (2-3 sec each)
```

### Phase 4: Debugging & Calibration

**`/memory-debug` output:**

```
Memory Health:
  Total embeddings: 90 (70 memories, 20 docs)
  Embedding model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
  Stale embeddings: 3 (3.3%)
    - .claude/memory/testing/feedback_new_pattern.md
    - docs/setup-guide.md

Retrieval Stats (last 30 sessions):
  Avg similarity of injected memories: 0.81
  Avg tokens injected: 1,340
  Zero-hit memories (never retrieved): 8
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
vector-inspector ~/.claude/contextus/data/automation contextus
```

Useful for identifying clusters of near-duplicate memories, visualizing coverage gaps, and validating that the embedding model separates your memory categories well.

## Storage & Git Integration

### ChromaDB Location

```
# In project (git-tracked)
.claude/
├── memory/              # Source files — committed, team-shared
│   ├── MEMORY.md
│   ├── sdk/
│   ├── testing/
│   └── framework/
└── settings.json        # Personal config — gitignored

# In user space (not in git)
~/.claude/contextus/
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
    "projectId": "automation-mobile"  // Override default
  }
}
```

### First Run

On first session in a project, embeddings build automatically:

```bash
cd automation
# First prompt triggers auto-build
→ Building ~/.claude/contextus/data/automation/
→ Indexing 90 files (70 memories + 20 docs + user memories)
→ ✓ Ready! (~15-20 seconds)
```

## Multi-Source Architecture

### Source Hierarchy

```typescript
const sourceWeights = {
  'projectMemory': 1.0,    // Local patterns (highest priority)
  'projectDocs': 0.9,      // Local documentation
  'userMemory': 0.8,       // Personal cross-project notes
  'parentMemory': 0.7,     // Parent repo patterns
  'userDocs': 0.7,
  'custom': 0.7            // Sibling projects, frameworks
};
```

All sources in one collection, single query per prompt. Source isolation via metadata, not separate collections.

### Custom Sources (Read-Only)

Custom sources (parent repos, siblings, frameworks) are read-only for retrieval. Writes always go to `projectMemory` or `userMemory`.

```bash
# Add custom source
/configure add-source ../.claude/memory --label parent

# List sources
/configure list-sources
✓ projectMemory: .claude/memory (70 files)
✓ projectDocs: docs (20 files)
✓ userMemory: ~/.claude/memory (12 files)
Total: 102 knowledge files indexed
```

### Auto-Detection

On first plugin load or `/configure discover`, scan parent directories and siblings for `.claude/memory/` and prompt to enable.

## Configuration Reference

### Environment Variables

```bash
MEMORY_RAG_ENABLED=true
MEMORY_RAG_CHROMA_PATH=~/.claude/contextus/data      # User space, not project
MEMORY_RAG_TOP_K=5
MEMORY_RAG_SIMILARITY_THRESHOLD=0.7
MEMORY_RAG_DEDUP_THRESHOLD=0.85
MEMORY_RAG_EMBEDDING_MODEL=nomic-ai/nomic-embed-text-v1.5
MEMORY_RAG_EMBEDDING_DIMENSIONS=768
MEMORY_RAG_AUTO_REBUILD=true
MEMORY_RAG_CAPTURE_MODE=propose
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
- [ ] **Confirm chunk strategy**: for freeform docs (dual embedding) vs structured memories (whole or chunk)
- [ ] **Test awareness hook wording** in real sessions with novelty signal format

During implementation:

- [ ] **Add `/health` endpoint** with `modelLoaded` field — session start hook polls this, not sleep()
- [ ] **Implement `ensureDaemonRunning()`** as shared JS utility (SessionStart + crash recovery)
- [ ] **Store embedding model + dimensions** in Chroma metadata at collection creation
- [ ] **Validate model + dimensions** on every query — fail fast with actionable error
- [ ] **Handle chunked results** with breadcrumb deduplication in `formatMemoriesForInjection`
- [ ] **Implement hit count tracking** — increment on every retrieval, expose in `/memory-debug`
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

### Other Potential Improvements

- **Hybrid search**: Combine semantic + keyword for exact term matches
- **Memory versioning**: Track changes over time, rollback support
- **Memory analytics**: Usage stats beyond hit count (session co-occurrence, etc.)
- **Multi-language support**: Non-English memories
- **Collaborative filtering**: “Users who found X useful also found Y useful”
- **Excerpt mode**: Claude requests truncated injection when approaching context limits

## References

- [DESIGN ADDENDUM.md](./DESIGN%20ADDENDUM.md) — Addendum decisions incorporated into this doc
- [Global Memory System](global-memory.md) — Current manual system
- [claude-mem](~/.claude-mem/settings.json) — Companion Chroma observation tracker
- [vector-inspector](https://github.com/anthonypdawson/vector-inspector) — Embedding visualization and debugging

-----

**Status**: Core scaffolding complete, implementation in progress

**Owner**: Anthony Dawson

**Priority**: Active