# Contextus Daemon API Reference

The contextus daemon is a persistent HTTP server running on `localhost:37800` that handles all context retrieval, embedding, and corpus management operations. This document describes all available endpoints, their parameters, responses, and usage patterns.

## Base URL

```
http://127.0.0.1:37800
```

## Architecture

The daemon maintains:
- **One shared embedding model** in memory (loaded once at boot)
- **Per-project LanceDB tables** (isolated by `project` parameter)
- **In-memory query stats** (reset on daemon restart)
- **In-memory novelty tracking** (recently-injected patterns per project)

All endpoints use JSON for request/response bodies. The daemon never blocks a prompt — when degradation is needed (provider down, corpus missing), it returns `{"continue": true}` so Claude proceeds without context.

---

## Endpoints

### `GET /health`

**Purpose:** Liveness and readiness check. Reports daemon status, model warm state, and expansion statistics.

**Query Parameters:**
- `probe` (optional) — If `true`, actively verifies the embedding provider is reachable by embedding a test query. Without this, health only reports cached state.

**Response:**
```json
{
  "status": "ok",
  "uptime": 45715.588,
  "modelLoaded": true,
  "warmupError": null,
  "lancedbConnected": true,
  "embeddingModel": "nomic-embed-text",
  "provider": "ollama",
  "expansion": {
    "mode": "adaptive",
    "queries": 3,
    "fired": 0,
    "skipped": 2,
    "fireRate": "0%"
  }
}
```

**Fields:**
- `status` — Always `"ok"` (if daemon is responding)
- `uptime` — Process uptime in seconds
- `modelLoaded` — `true` if embedding model is warm and ready; `false` if still loading or failed
- `warmupError` — Error message from model warmup failure, or `null` if healthy
- `lancedbConnected` — Always `true` (LanceDB is embedded)
- `embeddingModel` — Name of the active embedding model
- `provider` — Embedding provider (`"ollama"` or `"bedrock"`)
- `expansion` — Query expansion statistics (queries processed, how many fired expansion, fire rate %)

**Used by:** SessionStart hook to check daemon readiness before allowing context injection.

---

### `GET /novelty?project=<path>`

**Purpose:** Returns recently-injected pattern names for a project. Used by the awareness hook (context capture footer) to avoid proposing duplicate patterns.

**Query Parameters:**
- `project` (required) — Absolute path to the project directory

**Response:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "recent": [
    "dev/LOGGING.md",
    "calibration.md",
    "dev/DESIGN_QUESTIONS.md"
  ]
}
```

**Fields:**
- `project` — Echo of the requested project path
- `recent` — Array of pattern filenames injected in the last ~12 retrievals (most-recent-last)

**Behavior:**
- **In-memory only** — Resets on daemon restart (by design, not a bug)
- **Bounded window** — Keeps last 12 unique patterns per project
- **Deduplication** — Re-injected patterns move to most-recent position
- **Populated by injection** — Only tracks patterns that scored above the injection floor

**Used by:** The UserPromptSubmit hook's awareness footer to tell Claude which patterns already exist.

---

### `GET /introspect?project=<path>`

**Purpose:** Self-documentation endpoint. Returns live config, corpus statistics, hit tracking, and calibration state for a project.

**Query Parameters:**
- `project` (optional) — Absolute path to the project directory. If omitted, returns daemon-wide stats.

**Response:**
```json
{
  "version": "0.1.0",
  "uptimeSeconds": 45720.5,
  "modelLoaded": true,
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "config": {
    "retrieval": {
      "topK": 3,
      "injectionFloor": 0.45,
      "maxTokens": 4000,
      "provenanceFooter": true,
      "hybrid": "always"
    },
    "expansion": {
      "mode": "adaptive",
      "expansionThreshold": 0.55
    },
    "embedding": {
      "provider": "ollama",
      "model": "nomic-embed-text",
      "dimensions": 768
    }
  },
  "corpus": {
    "patternCount": 42,
    "totalChunks": 156,
    "embeddingModel": "nomic-embed-text",
    "dimensions": 768,
    "lastModified": "2026-06-18T10:23:45.123Z"
  },
  "hitTracking": {
    "topPatterns": [
      { "pattern": "dev/LOGGING.md", "hits": 15 },
      { "pattern": "calibration.md", "hits": 12 }
    ],
    "zeroHitPatterns": ["reference/unused-pattern.md"]
  },
  "calibration": {
    "evaluateUsage": false,
    "campaigns": []
  }
}
```

**Used by:** `/context-status` skill to populate the dashboard with real corpus statistics.

---

### `POST /query`

**Purpose:** Main retrieval pipeline. Embeds the prompt, searches the project corpus, reranks, applies injection floor, and formats results for injection.

**Request Body:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "prompt": "How does the daemon handle configuration changes?",
  "cwd": "/Users/Anthony.Dawson/src/claude-contextus"
}
```

**Parameters:**
- `project` (required) — Absolute path to project (identifies which LanceDB table to query)
- `prompt` (required) — User's prompt text to embed and search
- `cwd` (optional) — Project root directory for resolving git-committed config overrides

**Response (success with injection):**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[contextus — dev/LOGGING.md]\n\nLogging uses structured JSONL...\n\n---\n\n[contextus — calibration.md]\n\nCalibration works by...\n\n[contextus notice] Patterns above injected from: dev/LOGGING.md (0.72), calibration.md (0.58)"
  }
}
```

**Response (no injection):**
```json
{
  "continue": true
}
```

**Response (near-miss — bestScore > 0.25 but below floor):**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[contextus — retrieval gap detected]\nYour prompt nearly matched existing context but fell short of the injection threshold (best: 0.38, floor: 0.45, gap: 7%). Nearest topics: logging patterns, daemon lifecycle.\n\nThis means either:\n1. The knowledge exists but the context file doesn't cover this angle well enough\n2. This is a genuinely new topic that should be captured\n\nACTION: If your response surfaces reusable knowledge..."
  }
}
```

**Graceful Degradation Cases:**
Returns `{"continue": true}` (no `hookSpecificOutput`) when:
- Model not warm yet (still loading or warmup failed)
- No corpus exists for the project
- Embedding model/dimension mismatch between corpus and daemon config
- Provider down (triggers auto-recovery + keyword fallback if possible)
- Empty prompt
- All results dropped by injection floor

**Pipeline:**
1. **Embed prompt** — Convert text to 768-dim vector (or keyword fallback if provider down)
2. **Hybrid search** (if enabled) — Run semantic (vector) + keyword (BM25) in parallel, fuse with RRF
3. **Multi-vector expansion** (if adaptive/always) — Generate query variants, search each, union results
4. **Rerank** — Sort by similarity
5. **Collapse by file** — Keep one best chunk per file
6. **Top-K** — Trim to configured limit
7. **Dedupe** — Remove near-duplicate files
8. **Injection floor** — Drop patterns below similarity threshold
9. **Format** — Wrap in `[contextus — filename]` blocks with provenance footer

**Logging:**
- Logs retrieval event with pattern names, scores, tokens, latency
- Logs dropped patterns (below floor) with scores for calibration analysis
- Logs expansion events when fired (variants, provider, latency)
- Logs no-inject events when floor drops everything

**Side Effects:**
- Increments hit counters for injected patterns (used by `/introspect`)
- Records injection to novelty tracker (used by `/novelty`)
- Saves injection details to session state if calibration campaign active

**Used by:** UserPromptSubmit hook on every user prompt.

---

### `POST /search`

**Purpose:** Raw corpus search without injection floor filtering. Returns ALL matching patterns with similarity scores for debugging retrieval behavior. Used by `/context-search` skill.

**Request Body:**
```json
{
  "query": "How to handle logging?",
  "project": "e70f0dcf1fbd",
  "cwd": "/Users/Anthony.Dawson/src/my-project",
  "limit": 10
}
```

**Parameters:**
- `query` (required) — Search query text to embed
- `project` (optional) — Project identifier (name, hash, or path) — normalized to canonical hash
- `cwd` (optional) — Project root directory for workspace scope resolution
- `limit` (optional, default: 10) — Maximum results to return

**Response:**
```json
{
  "results": [
    {
      "id": "chunk-123",
      "filename": "reference/reference-logging.md",
      "description": "Project logging configuration and patterns",
      "type": "reference",
      "source": "projectContext",
      "similarity": 0.8432
    },
    {
      "id": "chunk-456",
      "filename": "decisions/decision-logger-choice.md",
      "description": "Why we chose Winston over Bunyan",
      "type": "decision",
      "source": "projectContext",
      "similarity": 0.7123
    }
  ],
  "query": "How to handle logging?",
  "project": "e70f0dcf1fbd"
}
```

**Key Differences from `/query`:**
- **No injection floor** — Returns results even if similarity < configured threshold
- **Simple JSON response** — Not wrapped in hook format
- **Raw scores** — All similarity values visible for debugging
- **No formatting** — Returns structured data, not markdown blocks
- **No side effects** — Doesn't increment hit counters or record to novelty tracker

**Use Cases:**
- Debug why patterns fall below injection floor
- Explore corpus contents without triggering injection
- Test retrieval quality before committing context changes
- Understand semantic similarity scores for calibration

**Graceful Degradation:**
Returns `{"results": [], ...}` when:
- Model not loaded yet
- No corpus exists for the project
- Query is empty
- Provider down (no keyword fallback in search mode)

**Used by:** `/context-search` skill for manual corpus exploration.

---

### `POST /capture`

**Purpose:** Atomically create a context file, update the CONTEXT.md index, and embed it. Designed for staging-mode capture with minimal UI noise — one HTTP call replaces Write + Edit + re-embed.

**Request Body:**
```json
{
  "category": "gotcha",
  "slug": "my-discovery",
  "description": "One-line description (gets embedded as the semantic signal)",
  "body": "Full body content with examples, reasoning, edge cases.",
  "tags": ["optional", "tag-list"],
  "scope": "project",
  "cwd": "/path/to/project",
  "project": "my-project"
}
```

**Parameters:**
- `target` (optional) — `"context"` (default) or `"doc"`. Controls file format and destination.
- `category` (required for context) — One of: `arch`, `decision`, `tradeoff`, `gotcha`, `api`, `phase`, `project`, `schema`, `security`, `perf`, `reference`, `implementation`
- `slug` (required) — Kebab-case identifier (becomes the filename and `name:` frontmatter)
- `description` (required for context, optional for doc) — One-line summary (embedded for retrieval)
- `body` (required) — Full markdown content (no frontmatter — the endpoint builds it for context; raw markdown for doc)
- `tags` (optional, context only) — Array of tag strings
- `scope` (optional) — `"project"` (default) or `"user"`. For context: project writes to `.claude/context/`, user to `~/.contextus/context/`. For doc: project writes to `docs/`, user to `~/.contextus/docs/`.
- `cwd` (optional) — Project root directory (defaults to daemon's cwd)
- `project` (optional) — Project name for embedding scope

**Doc mode** (`target: "doc"`):
```json
{
  "target": "doc",
  "slug": "api-patterns",
  "description": "Common API patterns in this project",
  "body": "# API Patterns\n\nFull markdown content here...",
  "scope": "project"
}
```
Writes free-form markdown (no frontmatter) to `docs/<slug>.md`, appends to `DOCS.md` index.

**Response (success):**
```json
{
  "ok": true,
  "file": "/absolute/path/to/decisions/decision-my-discovery.md",
  "relPath": "decisions/decision-my-discovery.md",
  "embedded": true,
  "scope": "project"
}
```

**Response (validation error):**
```json
{
  "error": "missing required fields: category, slug, description, body"
}
```

**Behavior:**
- Builds frontmatter from structured params (guaranteed valid format)
- Creates category directory if missing
- Appends one-line entry to CONTEXT.md (best-effort, non-fatal if missing)
- Embeds immediately via `embedSingleFile()`
- Logs to `~/.contextus/captures.log` audit trail
- Invalidates keyword corpus cache for immediate availability

**Used by:** Staging-mode capture (staging footer instructs Claude to POST here instead of using Write + Edit tool calls).

---

### `POST /notify`

**Purpose:** Incremental re-embed when a context file changes. Triggered by FileWrite hook watching `.claude/context/**/*.md`.

**Request Body:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "file": ".claude/context/dev/LOGGING.md",
  "cwd": "/Users/Anthony.Dawson/src/claude-contextus"
}
```

**Parameters:**
- `project` (required) — Absolute path to project
- `file` (required) — Changed file path (absolute or relative to `cwd`)
- `cwd` (optional) — Project root directory

**Response (file embedded):**
```json
{
  "ok": true,
  "embedded": true,
  "id": "dev/LOGGING.md"
}
```

**Response (non-context file, skipped):**
```json
{
  "ok": true,
  "embedded": false,
  "reason": "not_in_context_dir"
}
```

**Behavior:**
- Only embeds files under `.claude/context/` or `docs/` — other paths are silently skipped
- Updates existing embedding if file was previously embedded
- Validates frontmatter and skips files with invalid schema
- Logs incremental re-embed event

**Used by:** FileWrite hook (contextus-file-write) triggered by Write/Edit tool calls.

---

### `POST /reconcile`

**Purpose:** Sync a project's corpus with its `.claude/context/` directory. Adds new files, updates changed files, removes deleted files.

**Two Modes:**

#### Check Mode (dry-run)
Fast check to determine corpus state without embedding.

**Request:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "cwd": "/Users/Anthony.Dawson/src/claude-contextus",
  "check": true
}
```

**Response:**
```json
{
  "state": "stale",
  "toAdd": 3,
  "toUpdate": 2,
  "toRemove": 1
}
```

**States:**
- `"fresh"` — Corpus is up-to-date
- `"stale"` — Corpus exists but has pending changes
- `"missing"` — No corpus exists, needs initial embed
- `"empty"` — No context files found in `.claude/context/`

#### Reconcile Mode (background)
Runs the full embed/update/remove in the background and responds immediately.

**Request:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "cwd": "/Users/Anthony.Dawson/src/claude-contextus"
}
```

**Response (started):**
```json
{
  "state": "started"
}
```

**Response (already running):**
```json
{
  "state": "busy"
}
```

**Response (no changes needed):**
```json
{
  "state": "noop"
}
```

**Background Behavior:**
- Runs asynchronously — does not block the HTTP response
- Prevents concurrent reconciles on same project (returns `"busy"`)
- Logs completion stats (embedded, removed, latency)
- Handles model loading automatically (cold-start first embed)

**Used by:**
- SessionStart hook (`check: true`) to detect stale corpus
- SessionStart hook (background reconcile) to bring corpus up-to-date
- `/rebuild-embeddings` skill for manual full/incremental rebuilds

---

## Error Handling

The daemon is designed to **never block a prompt**. All degradation scenarios return:
```json
{
  "continue": true
}
```

This tells the hook to proceed without injecting context. Errors are logged but don't propagate to the user as HTTP errors.

### Common Degradation Scenarios

1. **Model not warm** — First prompt or two after daemon start get no context
2. **Provider down** — Falls back to keyword search if possible, else no injection
3. **Model mismatch** — Corpus built with different model than daemon config
4. **Dimension mismatch** — Corpus vectors have different dimensionality than config
5. **No corpus** — Project has no `.claude/context/` or hasn't been embedded yet
6. **Malformed request** — Invalid JSON, missing fields, oversized body

### Auto-Recovery

When embedding fails mid-session (provider drops), the daemon:
1. Marks `modelLoaded = false`
2. Sets `warmupError` to the error message
3. Triggers background re-warmup with exponential backoff (10s, 20s, 40s, 80s, 160s)
4. Returns `{"continue": true}` for current request (graceful degradation)
5. Logs the failure + retry schedule

Future requests will succeed once the provider recovers and warmup completes.

---

## Configuration

The daemon loads config from a 3-tier merge on every `/query` request:

1. `plugin.jsonc` — Plugin defaults (ships with contextus)
2. `~/.contextus/data/<project>/config.json` — Per-user, per-project overrides
3. `.claude/contextus.jsonc` — Git-committed project overrides (highest precedence)

**Config hot-reloads** — Edit any file and the next query picks up changes. No daemon restart needed.

See `examples/contextus.jsonc` for annotated reference.

---

## Runtime Files

The daemon writes runtime state to `~/.contextus/runtime/`:
- `daemon.pid` — Process ID (used to check if daemon is running)
- `daemon.port` — Port number (currently hard-coded to 37800)

These files are removed on graceful shutdown (`SIGINT`, `SIGTERM`).

---

## Logging

All events are logged to `~/.contextus/logs/` in structured JSONL:
- `daemon.log` — All events (retrieval, no-inject, expansion, errors)
- `usage.jsonl` — Retrieval events only (for calibration analysis)
- `errors.jsonl` — Error events only
- `paranoid.jsonl` — Full prompt + injection details (dev mode, disabled by default)

Logs auto-rotate at 10MB to prevent disk bloat.

Use `/contextus-watch` skill to tail `daemon.log` with colored, formatted output.

---

## Security

- **Localhost-only** — Daemon binds to `127.0.0.1`, not `0.0.0.0`
- **Single-user** — No authentication (assumes trusted local process)
- **No CORS** — Not designed for browser access
- **Request size limit** — JSON bodies capped at 1MB
- **No arbitrary file access** — Only reads files under `.claude/context/` and `docs/`

---

## Performance

**Typical Latency:**
- `/health` — <1ms (in-memory read)
- `/novelty` — <1ms (in-memory read)
- `/introspect` — 5-20ms (reads corpus metadata from LanceDB)
- `/query` (pure semantic) — 50-150ms (embed + search + rerank + floor)
- `/query` (with hybrid) — 70-180ms (+20ms keyword search overhead)
- `/query` (with expansion) — 150-400ms (Ollama qwen2.5:3b) or 2s+ (Bedrock Haiku)
- `/notify` (single file) — 100-300ms (embed + write to LanceDB)
- `/reconcile` (check only) — 10-50ms (disk scan + hash comparison)
- `/reconcile` (full rebuild) — 30-60s for 50 files, first-run (model load + embed)

**Concurrency:**
- All requests are handled sequentially (Node.js event loop, single-threaded)
- Embedding is CPU-bound (Ollama) or network-bound (Bedrock)
- No request queuing or backpressure — trust the hook to not spam

---

## Testing

**Quick script (covers all endpoints):**
```bash
./scripts/test-api.sh all           # run everything
./scripts/test-api.sh health        # just health
./scripts/test-api.sh query "How does config work?"  # custom prompt
```

**Individual curl examples:**

**Health check:**
```bash
curl -s http://localhost:37800/health | jq .
```

**Provider probe:**
```bash
curl -s "http://localhost:37800/health?probe=true" | jq .
```

**Query test:**
```bash
curl -s -X POST http://localhost:37800/query \
  -H "Content-Type: application/json" \
  -d '{
    "project": "/Users/Anthony.Dawson/src/claude-contextus",
    "prompt": "How does logging work?"
  }' | jq .
```

**Novelty check:**
```bash
curl -s "http://localhost:37800/novelty?project=/Users/Anthony.Dawson/src/claude-contextus" | jq .
```

**Introspect corpus:**
```bash
curl -s "http://localhost:37800/introspect?project=/Users/Anthony.Dawson/src/claude-contextus" | jq .
```

---

## Version

This document describes daemon protocol version **0.1.0** (as reported by `/introspect`).

Keep in sync with `plugin.json` version.
