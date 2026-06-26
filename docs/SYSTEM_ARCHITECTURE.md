# claude-contextus: System Architecture

## 30,000-Foot View

**claude-contextus** is a proactive semantic context delivery system. It watches your project's `.claude/context/` files, embeds them into vectors, and injects the most relevant ones on every Claude Code prompt — automatically, without you searching or asking.

```
┌──────────────────────────────────────────────────────────────────────┐
│                    User Writing Prompt in Claude Code                 │
│                              (any project)                            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ↓ UserPromptSubmit hook fires
┌──────────────────────────────────────────────────────────────────────┐
│ Hook Script (daemon/hooks/UserPromptSubmit.js)                       │
│   • Extracts prompt text                                              │
│   • Identifies project (via cwd or manifest)                          │
│   • Computes projectId hash                                           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                │                             │
    ┌───────────▼────────────┐   ┌───────────▼────────────┐
    │ Daemon not running?    │   │ Daemon is running      │
    │ Auto-start via         │   │ (already loaded model) │
    │ ensureDaemonRunning()  │   │                        │
    └───────────┬────────────┘   └───────────┬────────────┘
                │                             │
                └──────────────┬──────────────┘
                               │
                               ↓ HTTP POST to localhost:37800
        ┌──────────────────────────────────────────────────────┐
        │    CONTEXTUS DAEMON (daemon/server.ts)               │
        │        Persistent HTTP server                        │
        │    Port: 37800 (on localhost only)                   │
        └──────────────────────────────────────────────────────┘
                               │
                 ┌─────────────┼─────────────┐
                 │             │             │
         /query endpoint  /reconcile     /capture
         (retrieve context) (sync corpus) (save file)
                 │
                 ↓ POST /query
        ┌────────────────────────────┐
        │  handleQuery() pipeline     │
        │  (daemon/server.ts ~line   │
        │   160-300)                  │
        └────────────────────────────┘
                 │
        ┌────────┴────────────────────────────────┐
        │                                          │
        │  1. EMBEDDING LAYER                      │
        │     embedQuery(prompt)                   │
        │                                          │
        │     ┌──────────────────────────────┐    │
        │     │ Provider Selection            │    │
        │     │ • transformers.js (default)  │    │
        │     │   @xenova/transformers       │    │
        │     │   In-process ONNX inference  │    │
        │     │                              │    │
        │     │ • ollama (fallback)          │    │
        │     │   Local HTTP server          │    │
        │     │   For offline/proxy scenarios│    │
        │     └──────────────────────────────┘    │
        │                                          │
        │     Asymmetric retrieval:                │
        │     • search_query: PREFIX applied       │
        │     • L2 normalized 768-dim vectors      │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  2. VECTOR SEARCH (Lance)                │
        │     search(embedding, top_k=20)          │
        │                                          │
        │     ┌──────────────────────────────┐    │
        │     │ LanceDB                       │    │
        │     │ Persistent vector DB          │    │
        │     │ Per-project directory         │    │
        │     │                               │    │
        │     │ ~/.contextus/data/<proj>/     │    │
        │     │   ├── project.lance           │    │
        │     │   ├── project.meta            │    │
        │     │   └── [other metadata]        │    │
        │     │                               │    │
        │     │ Stores:                       │    │
        │     │ • text (original content)     │    │
        │     │ • vector (768-dim)            │    │
        │     │ • file (source path)          │    │
        │     │ • type (decision/arch/etc)    │    │
        │     │ • tags (searchable labels)    │    │
        │     │ • hit_count (usage frequency)│    │
        │     └──────────────────────────────┘    │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  3. HYBRID RETRIEVAL                     │
        │     hybridKeywordSearch()                │
        │                                          │
        │     ┌──────────────────────────────┐    │
        │     │ Vector Path                   │    │
        │     │ (from step 2)                 │    │
        │     │ [vec search results]          │    │
        │     └──────────────┬────────────────┘    │
        │                    │                     │
        │                    ↓                     │
        │     ┌──────────────────────────────┐    │
        │     │ Keyword Path                  │    │
        │     │ keywordSearch()               │    │
        │     │ • BM25 scoring                │    │
        │     │ • Tokenization                │    │
        │     │ • Term frequency analysis     │    │
        │     │ [keyword results]             │    │
        │     └──────────────┬────────────────┘    │
        │                    │                     │
        │                    ↓                     │
        │     ┌──────────────────────────────┐    │
        │     │ RRF Fusion                    │    │
        │     │ fuseRRF(vector, keyword)      │    │
        │     │ Reciprocal Rank Fusion        │    │
        │     │ [merged results, ranked]      │    │
        │     └──────────────────────────────┘    │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  4. QUERY EXPANSION (Adaptive)           │
        │     shouldExpand()? expandQuery()        │
        │                                          │
        │     Fires when best_score < 0.55        │
        │     • Generates alternate phrasings      │
        │     • Re-runs vector search              │
        │     • Merges back into results           │
        │                                          │
        │     Provider chain:                      │
        │     • Ollama (qwen2.5:3b, ~100-400ms)   │
        │     • Bedrock fallback (Haiku, ~2s)      │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  5. RERANKING + SCORING                  │
        │     rerank(candidates)                   │
        │     processSearchResults()               │
        │                                          │
        │     Multi-factor reranking:              │
        │     • Similarity score (vector/keyword)  │
        │     • Freshness decay (file mtime)       │
        │     • Hit count boost (popularity)       │
        │     • BM25 weight                        │
        │     • Type preference                    │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  6. INJECTION FLOOR                      │
        │     applyFloor(threshold=0.45)           │
        │                                          │
        │     • Drops low-relevance chunks         │
        │     • Default floor: 0.45 similarity     │
        │     • Tunable via config or calibration  │
        │     • Floor-dropped results logged       │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  7. DEDUPLICATION                        │
        │     dedupe() / collapseByFile()          │
        │                                          │
        │     • Cosine similarity threshold (0.95) │
        │     • Collapse similar chunks            │
        │     • Prefer earlier/higher-scoring      │
        │                                          │
        ├──────────────────────────────────────────┤
        │                                          │
        │  8. FORMAT + INJECT                      │
        │     formatInjection()                    │
        │                                          │
        │     Output structure:                    │
        │     [contextus — <files>]                │
        │     <chunk 1 text>                       │
        │     (file.md, score 0.95)                │
        │                                          │
        │     <chunk 2 text>                       │
        │     (file.md, score 0.87)                │
        │                                          │
        │     [contextus footer] — usage           │
        │     instructions (inject/write/silent)   │
        │                                          │
        └────────────────────────────────────────────┘
                 │
                 ↓ HTTP 200 response
        ┌────────────────────────────────┐
        │ {                              │
        │   continue: true,              │
        │   hookSpecificOutput: {        │
        │     additionalContext: "..."   │
        │   }                            │
        │ }                              │
        └────────────────────────────────┘
                 │
                 ↓ Hook injects into prompt
        ┌────────────────────────────────┐
        │ Claude receives:               │
        │                                │
        │ [injected context]             │
        │ [original user prompt]         │
        │                                │
        │ • Stateless from Claude's POV  │
        │ • Context already in token     │
        │   budget                       │
        │ • Claude can cite context      │
        │   using file:line notation     │
        └────────────────────────────────┘
```

---

## The Three "Layers" (and when each fires)

### Layer 1: SessionStart (Daemon Lifecycle)

**Trigger:** Claude Code starts a session  
**File:** `daemon/hooks/SessionStart.js`

```
┌─────────────────────────────────────┐
│   SessionStart Hook                 │
│                                     │
│   1. Check if daemon is running     │
│      • Read ~/.contextus/runtime/   │
│        daemon.pid                   │
│                                     │
│   2. If not running:                │
│      • Load embedding model         │
│        (2-5s first time, CPU-bound) │
│      • Write PID to daemon.pid      │
│      • Listen on localhost:37800    │
│                                     │
│   3. If running:                    │
│      • Verify it's responsive       │
│      • Skip startup                 │
│                                     │
│   4. Watcher thread                 │
│      • File system events on        │
│        .claude/context/             │
│      • Watch for *.md changes       │
└─────────────────────────────────────┘
         │
         ↓ triggers /reconcile
┌─────────────────────────────────────┐
│ handleReconcile (daemon/server.ts)  │
│                                     │
│ 1. Load all .md files from:         │
│    • .claude/context/               │
│    • ~/.contextus/context/          │
│    • docs/ (optional)               │
│                                     │
│ 2. Parse frontmatter (YAML)         │
│    Extract metadata:                │
│    • name (slug)                    │
│    • description                    │
│    • type (arch/decision/etc)       │
│    • tags (optional)                │
│                                     │
│ 3. Plan reconciliation:             │
│    • Compare disk vs LanceDB        │
│    • Detect: add/update/delete      │
│    • Compute content hashes         │
│                                     │
│ 4. For each file:                   │
│    a) Split into chunks             │
│       (headings, semantic)          │
│    b) Embed each chunk              │
│       (embedDocument with prefix)   │
│    c) Upsert into LanceDB           │
│                                     │
│ 5. Record results                   │
│    • Log # embedded, # removed      │
│    • Invalidate keyword cache       │
│    • Return stats to hook           │
└─────────────────────────────────────┘
```

### Layer 2: UserPromptSubmit (Query + Injection)

**Trigger:** User writes a prompt in Claude Code  
**File:** `daemon/hooks/UserPromptSubmit.js`

The main retrieval + injection pipeline (diagrammed above).

### Layer 3: Stop Hook (Usage Tracking)

**Trigger:** Claude finishes responding  
**File:** `daemon/hooks/Stop.js`

```
┌─────────────────────────────────────┐
│ Stop Hook (end of turn)             │
│                                     │
│ 1. Read footer instruction from     │
│    Claude's response (if present)   │
│                                     │
│ 2. No-op for now (v1)               │
│    • Usage evaluation not yet impl. │
│    • Planned: calibration feedback  │
│                                     │
│ 3. Future (v2):                     │
│    • Extract which chunks were      │
│      cited/mentioned                │
│    • Compute gradient rating        │
│      (critical/helpful/mentioned)   │
│    • Log for floor calibration      │
└─────────────────────────────────────┘
```

---

## Directory Layout

```
claude-contextus/
├── daemon/
│   ├── server.ts                    # HTTP server (main entry point)
│   ├── hooks/
│   │   ├── SessionStart.js          # Daemon lifecycle + initial reconcile
│   │   ├── UserPromptSubmit.js      # Trigger retrieval pipeline
│   │   └── Stop.js                  # Usage tracking (future)
│   └── [hooks registration]
│
├── lib/
│   ├── config.ts                    # 3-tier config merge (plugin → user → project)
│   ├── logger.ts                    # File-based logging (no external deps)
│   ├── session-state.ts             # Track per-session injection history
│   │
│   ├── embedding/
│   │   ├── embedder.ts              # Provider abstraction (transformers/ollama)
│   │   ├── model-resolver.ts        # Model path resolution + preflight
│   │   ├── context-loader.ts        # Parse .md files + frontmatter
│   │   ├── chunker.ts               # Split .md by headings + semantics
│   │   ├── file-to-rows.ts          # Transform chunks → DB rows
│   │   ├── embed-file.ts            # Single-file embed job
│   │   └── reconcile-run.ts         # Orchestrate full corpus re-embed
│   │
│   ├── storage/
│   │   ├── lance-client.ts          # LanceDB wrapper (open/search/upsert)
│   │   ├── reconcile.ts             # Plan add/update/delete ops
│   │   └── staleness.ts             # Detect stale cached results
│   │
│   ├── retrieval/
│   │   ├── expand.ts                # Query expansion (LLM-driven)
│   │   ├── hybrid.ts                # Vector + keyword fusion (RRF)
│   │   ├── keyword.ts               # BM25 keyword search
│   │   ├── reranker.ts              # Multi-factor reranking
│   │   ├── floor.ts                 # Injection floor logic
│   │   ├── dedup.ts                 # Cosine similarity deduplication
│   │   ├── inject-format.ts         # Format output + estimate tokens
│   │   ├── pipeline.ts              # Main query orchestration
│   │   ├── miss-notice.ts           # Diagnostic when no results hit floor
│   │   └── [other utilities]
│   │
│   ├── capture/
│   │   ├── novelty.ts               # Track recently-injected patterns
│   │   └── [audit logs]
│   │
│   ├── calibration/
│   │   ├── calibration-state.ts     # Persist floor replay state
│   │   └── [replay logic]
│   │
│   ├── workspace.ts                 # Multi-project workspace logic
│   ├── introspect.ts                # Self-doc for /introspect endpoint
│   ├── log-rotation.ts              # Rotate activity logs
│   │
│   └── prompts/                     # Externalized prompt templates
│       ├── expand-query.md          # LLM prompt for query expansion
│       └── [other templates]
│
├── scripts/
│   ├── cli/                         # Runnable CLI commands (via tsx)
│   │   ├── floor-replay.ts          # Debug: replay floor decisions
│   │   ├── ingest-*.ts              # Manual corpus builders
│   │   └── [other utilities]
│   │
│   └── [other tooling]
│
├── tests/                           # Unit tests (node:test)
├── hooks.json                       # Hook registration
├── plugin.json                      # Plugin metadata + schema
├── .claude/
│   ├── contextus.jsonc              # Project config overrides
│   └── context/                     # This project's own context (dogfood)
├── docs/
│   ├── API.md                       # HTTP endpoint reference
│   ├── DESIGN.md                    # Architecture & decision history
│   ├── dev/
│   │   ├── ROADMAP.md               # v2 backlog
│   │   ├── EMBEDDING.md             # Deep dive on embeddings
│   │   ├── DAEMON_LIFECYCLE.md      # Session vs. always-on
│   │   └── [other design docs]
│   └── [user-facing guides]
│
└── [build artifacts, examples, etc]
```

---

## Config (3-Tier Merge)

**Principle:** Config hot-reloads on every query. No daemon restart needed.

```
┌────────────────────────────────────┐
│ plugin.jsonc                       │
│ (ships with contextus)             │
│                                    │
│ - default model (nomic-embed-text) │
│ - default floor (0.45)             │
│ - default expansion mode (adaptive)│
│ - provider chain (ollama → bedrock)│
└─────────┬──────────────────────────┘
          │
          │ merged by
          ↓
┌────────────────────────────────────┐
│ ~/.contextus/data/<proj>/          │
│ config.json                        │
│ (written by contextus at first     │
│  run to capture env-specific       │
│  settings)                         │
│                                    │
│ - custom model path                │
│ - bedrock credentials              │
│ - logging level                    │
└─────────┬──────────────────────────┘
          │
          │ merged by
          ↓
┌────────────────────────────────────┐
│ .claude/contextus.jsonc            │
│ (git-committed, team-wide)         │
│                                    │
│ - project-specific floor           │
│ - custom prompt templates          │
│ - corpus sources (what to index)   │
│ - provider overrides               │
└────────────────────────────────────┘
```

---

## Key Concepts

### Embedding Providers

Both produce the same vector space (nomic-embed-text, 768-dim, L2 normalized):

| Provider | Runtime | Model Source | Use Case |
|----------|---------|--------------|----------|
| **transformers.js** | In-process ONNX | @xenova/transformers | Default; fast; no daemon dependency |
| **ollama** | Local HTTP POST | Local Ollama server | Fallback; offline; corporate proxy scenarios |

### Asymmetric Retrieval

The model was trained with instruction prefixes:
- **Documents stored with:** `search_document: <text>`
- **Queries embedded with:** `search_query: <prompt>`

This improves cross-modal retrieval quality. Disable via env `CONTEXTUS_NOMIC_PREFIXES=0` for A/B testing.

### Vector Search Strategy

```
User Prompt
    │
    ├─────────────────────┬──────────────┐
    │                     │              │
    ↓                     ↓              ↓
  Vector         Keyword Search      Combined
  Search         (BM25)              (RRF)
  (cosine)
    │                     │              │
    └──────────────┬──────┴──────────────┘
                   │
                   ↓
            Ranked candidates
                   │
                   ├─ Rerank (multi-factor)
                   ├─ Apply floor
                   ├─ Deduplicate
                   └─ Format + send
```

**RRF (Reciprocal Rank Fusion):** Merges vector + keyword results by combining their rank positions, preventing one modality from dominating.

### Injection Floor

- **Default:** 0.45 similarity score
- **Meaning:** Only chunks with ≥0.45 cosine similarity are included
- **Why:** Below 0.45, results are typically noise (generic docs, low relevance)
- **Tunable:** Via config or via `floor-replay` calibration tool

### Deduplication

After all filtering, dedupe by cosine similarity (threshold 0.95):
- Prevents the same idea from appearing twice
- Keeps the higher-scoring version
- Critical for staying within token budgets

---

## Multi-Project Architecture (Unified DB + Workspaces)

The daemon is **single, shared** across all your projects on a machine. All projects write to **one unified LanceDB** at `~/.contextus/data/contextus.lance`.

```
┌─────────────────────────────────────────┐
│ One Daemon (localhost:37800)            │
│ • Loads embedding model once (shared)   │
│ • Single unified LanceDB (all projects) │
│ • Per-project query scoping via column  │
└─────────────────────────────────────────┘
         │
    ┌────┼────┬────┐
    │    │    │    │
    ↓    ↓    ↓    ↓
Project Project Project Project
   A       B      C       D
   │       │      │       │
   └───────┴──────┴────────┘
    ~/.contextus/data/
    contextus.lance    ← Single DB, all projects
    contextus.meta     ← Metadata sidecar
    
    Rows scoped by projectId column:
    ├─ project=hash-A: 42 rows (A's context)
    ├─ project=hash-B: 38 rows (B's context)
    ├─ project=hash-C: 55 rows (C's context)
    ├─ project=hash-D: 29 rows (D's context)
    ├─ project=hash-A,B: 12 rows (shared workspace)
    └─ project=<personal>: 100 rows (personal docs)
```

**Project Isolation via `projectId` Hash + Workspaces:**
- Hash = `sha256(absolutePath).slice(0, 12)` (opaque, stable)
- Each query/reconcile includes the projectId
- Database queries are scoped: `WHERE project IN (self + workspace siblings)`
- Query results weighted: own project (1.0) vs. siblings (0.85)
- Projects in no workspace only see their own rows
- Personal context (`~/.claude/memory`, `~/.claude/docs`) always included (sentinel project)

---

## Storage: Unified LanceDB

**Why LanceDB?**
- Fast vector search (built on Apache Arrow)
- Persistent on disk (survives daemon restart)
- Native support for schema + metadata
- No server to manage (file-based)

**Why Unified?**
- Per-project DBs = N copies when projects link (duplication)
- Single DB = one connection, one reconcile, cleaner lifecycle
- Workspaces enable symmetric cross-project sharing (more intuitive)
- Easier to share personal context across all projects

**Schema:**
```
Row {
  projectId: string           # sha256(absolutePath).slice(0, 12)
                              # or <personal> for user docs/memory
  name: string                # slug (kebab-case)
  category: string            # "arch" | "decision" | "impl" | etc
  type: string                # metadata.type from frontmatter
  tags: string                # comma-separated labels
  file: string                # source file path
  content: string             # full chunk text
  vector: number[768]         # L2-normalized embedding
  metadata: JSON              # arbitrary metadata from frontmatter
  mtime: number               # file's modification time (ms)
  hit_count: number           # # of times this chunk was injected
  last_hit: number            # timestamp of last injection
  source: string              # "project" | "linkedContext:<name>" | "personal"
}
```

**Sidecar Metadata** (`contextus.meta`):
```json
{
  "dbVersion": 2,
  "embeddingProvider": "transformers",
  "embeddingModel": "nomic-embed-text",
  "embeddingDims": 768,
  "createdAt": "2026-06-24T...",
  "lastReconcile": "2026-06-24T...",
  "totalRows": 1234,
  "totalProjects": 4
}
```

**Workspaces** (`~/.contextus/workspaces/<name>.jsonc`):
```jsonc
// engineering.jsonc
{
  "name": "engineering",
  "description": "Shared patterns across backend, frontend, infra",
  "projects": [
    "/Users/alice/src/api",
    "/Users/alice/src/web",
    "/Users/alice/src/devops"
  ]
  // Query from any project sees all 3's context weighted 0.85
  // Personal context always included (weight 1.0)
}
```

---

## Observability

### Logging

All logs are **file-based** (no external services, pure stdlib):

```
~/.contextus/
├── logs/
│   ├── activity-2026-06-24.log          # Main query/embed log
│   ├── activity-2026-06-23.log
│   └── [older, rotated]
├── captures.log                         # /capture endpoint calls
├── daemon.pid
└── runtime/
    └── daemon.port
```

**Activity log** entry for `/query`:
```
2026-06-24T10:23:45.123Z | Query | project=foo | prompt_hash=abc123 | results=5 | injected=3 | floor=0.45 | expansion=no | duration_ms=245
2026-06-24T10:23:45.370Z | Retrieval | vectors=0.92,0.88,0.76 (dropped: 0.42) | sources=decision-foo.md,arch-bar.md | tokens_est=450
```

### Dashboard: `/context-status` Skill

Queries `/introspect` endpoint:
```
GET /introspect
{
  "daemon_version": "0.1.0",
  "uptime_s": 1234,
  "embedding_model": "nomic-embed-text",
  "embedding_provider": "transformers",
  "corpus_stats": {
    "total_files": 42,
    "total_chunks": 1338,
    "total_size_mb": 2.4,
    "last_reconcile": "2026-06-24T..."
  },
  "lancedb_path": "~/.contextus/data/project-abc/",
  "config": { ... }
}
```

### Watch: `/contextus-watch` Skill

Tails activity log in real-time:
```bash
tail -f ~/.contextus/logs/activity-*.log | format_humanly
```

---

## Calibration (Floor Tuning)

**Problem:** How do you know if 0.45 is the right floor for YOUR projects?

**Solution:** Floor replay.

```
┌──────────────────────────────┐
│ pnpm run floor-replay        │
│                              │
│ 1. Load all past injections  │
│    (from activity log)       │
│                              │
│ 2. For each injection:       │
│    Re-run /query with same   │
│    prompt, capture scores    │
│                              │
│ 3. Sweep floors 0.30-0.70    │
│                              │
│ 4. Measure:                  │
│    • # of results @ each     │
│    • Estimated tokens        │
│    • Stability (same 3?)     │
│                              │
│ 5. Recommend floor           │
│    (e.g., "0.50 gives 3      │
│     stable results per       │
│     query")                  │
└──────────────────────────────┘
```

**v2 (Planned):**
- Stop hook evaluates claude's response
- Measures which chunks were actually used
- Feeds back into reranker weights
- RLHF-style feedback loop

---

## Error Recovery

| Scenario | Behavior |
|----------|----------|
| Daemon crashes | SessionStart restarts it (5s penalty) |
| LanceDB corrupted | Re-embed corpus (can force via `/reconcile?check=true`) |
| Model unavailable (Ollama down) | Falls back to Bedrock (if configured) |
| Query times out | Return early with best-so-far results |
| Floor too high | No injection (logged as "no hits") |
| Memory pressure | Log warning, continue (no OOM kill) |

---

## Performance Characteristics

**M4 Pro 48GB** (typical dev machine):

| Operation | Time | Notes |
|-----------|------|-------|
| Daemon startup (cold) | 2-5s | Model load (ONNX CPU) |
| Daemon startup (warm) | <100ms | Just bind port |
| Embedding query (single text) | 50-200ms | Transformers.js in-process |
| Vector search (top-20) | 10-50ms | LanceDB index lookup |
| Keyword search (full corpus) | 100-500ms | BM25 scoring (depends on corpus size) |
| Query expansion (Ollama) | 100-400ms | LLM generation (qwen2.5:3b) |
| Query expansion (fallback Bedrock) | 1-3s | Higher latency, but reliable |
| Full /query pipeline | 200-800ms | Typical case (no expansion) |
| Reconcile (100 files, 1k chunks) | 30-60s | Embedding batch job |

**Idle daemon memory:** ~136MB (mostly model weights cached).

---

## Architecture Decisions (Why?)

### Single Daemon vs. Per-Project

**Why one shared daemon?**
- Model weights are huge; loading per-prompt would be 2-5s overhead
- Single process = one copy of model in memory
- HTTP API isolates projects cleanly
- Unified DB avoids duplication when projects link

**Trade-off:** If daemon crashes, all projects lose retrieval (for a few seconds).  
**Mitigation:** SessionStart restarts it automatically.

### Unified DB vs. Per-Project DBs

**Why unified?**
- Per-project = N copies of shared context (duplication when linking)
- Single DB = one reconcile path, no orphan-cleanup complexity
- Workspaces model ("these projects are related") more naturally than directed links
- Easier to share personal context across all projects

**Isolation:**
- `projectId` hash column (`sha256(absolutePath).slice(0, 12)`) scopes queries
- Query scope: `WHERE project IN (self + workspace siblings)`
- Proximity weighting: own project (1.0) vs. siblings (0.85 configurable)
- Personal context always included (sentinel project value)

### File-Based Config over Database

**Why not a config server?**
- Hot-reload: edit a file, next query picks it up
- Mergeable: 3-tier system avoids conflicts
- Human-readable: JSONC (comments allowed)
- Debuggable: easy to inspect and test

### LanceDB over Other Vectors DBs

**Why LanceDB?**
- No server process (file-based)
- Fast enough for retrieval (<100ms)
- Native schema + metadata
- Persistent (survives restarts)
- Apache Arrow under the hood (industry standard)

**Why not**: Weaviate/Pinecone (need servers), Qdrant (overkill for single user), FAISS (no metadata).

### Nomic-Embed-Text (not custom embeddings)

**Why off-the-shelf?**
- Proven: used in production by many
- Small enough to run locally (768-dim)
- Asymmetric retrieval baked in (search_query/search_document)
- Multilingual support
- Not tied to Claude or any LLM

### Async Expansion (not synchronous)

**Why expand at query time?**
- Rare case (only when score < 0.55)
- Makes failures graceful (return early with best-so-far)
- Avoids cold-startup bloat

**Why not pre-compute all expansions?**
- Explosion of permutations (too many to embed)
- Most queries don't need expansion

---

## Next Steps (V2 Roadmap)

See `docs/dev/V2_ROADMAP.md` for full details. Key items:

1. **Usage Evaluation (Stop hook)** — Measure which injected chunks Claude actually used
2. **RLHF Feedback Loop** — Reweight search based on evaluation
3. **Workspace Linking** — Share context across projects (e.g., team patterns)
4. **Calibration UI** — Visual floor tuning
5. **Packaging** — Distribute as npm package with `/contextus-setup` wizard
6. **External Memory Sources** — Ingest from claude-mem, Linear, GitHub, etc.
