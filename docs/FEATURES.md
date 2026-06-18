# Features

**claude-contextus** is a comprehensive proactive context system for Claude Code. This document covers all capabilities — for a high-level overview, see the [README](../README.md).

## Core Capabilities

### 🎯 Proactive Context Delivery

- **Zero-query injection** — Relevant patterns appear automatically on every prompt without manual searching
- **Semantic retrieval** — Finds by meaning, not keywords (e.g., "how do I log?" matches Logger patterns)
- **Multi-source search** — Queries project context, project docs, user context, and user docs simultaneously
- **Automatic rebuilds** — Embeddings stay fresh; file changes trigger incremental re-embedding
- **Configurable injection** — Tune top-k, similarity floor, and max tokens per your needs

### 🧠 Advanced Retrieval

#### Hybrid Search (Semantic + Keyword Fusion)
- **RRF-based fusion** — Merges vector (semantic) and BM25 (keyword) results via Reciprocal Rank Fusion
- **Exact-symbol coverage** — Nails queries like "getLogger" or "expandHome" that pure embeddings dilute
- **Configurable mode** — `always` (every query) or `off` (pure semantic)
- **Parallel execution** — Keyword scan runs alongside vector search (~20ms overhead)

#### Multi-Vector Query Expansion
- **Adaptive expansion** — When initial search scores poorly (< 0.55), generates alternate phrasings
- **Fast LLM variants** — Uses qwen2.5:3b (Ollama) or Haiku (Bedrock) for query reformulation
- **Parallel re-search** — Each variant searched in parallel, results unioned with original
- **Provider fallback** — Ollama → Bedrock chain with shared timeout budget

#### Retrieval-Miss Proposals
- **Near-miss detection** — When bestScore > 0.25 but < injection floor (gap detected), surfaces evidence-driven capture proposals
- **Actionable prompting** — Tells Claude exactly what topics were close and the score gap, prompting either a capture proposal or a user question
- **Not passive** — Fires based on concrete retrieval data, not generic "notice something" footers
- **Score transparency** — Shows best score, floor, gap %, and nearest topic names in the notice

#### Keyword Fallback (Degradation)
- **Provider-down safety** — When embedding fails (Ollama unreachable), falls back to BM25 text search
- **Clear provenance** — Results tagged with "[contextus notice] keyword fallback" so users know
- **Conservative gate** — Short queries (< 2 terms) return nothing to avoid garbage

### 📊 Quality & Observability

#### Calibration System
- **Injection floor tuning** — `/context-calibrate --floor` replays usage logs to find optimal threshold
- **Usage evaluation** — Post-prompt Stop hook evaluates which patterns were actually used (v2)
- **Token cost reporting** — `/context-status --cost` shows overhead % paired with usage rate
- **Honest metrics** — Reports raw overhead without spin, paired with value signal

#### Logging & Debugging
- **Structured logging** — All events in JSONL (retrieval, no-inject, errors, paranoid)
- **Log rotation** — Automatic archive at 10MB to prevent disk bloat
- **Live activity stream** — `/contextus-watch` tails daemon.log with colored, formatted output
- **Paranoid mode** — Dev-mode verbose logging (controlled by config toggle)
- **Self-documentation** — `/introspect` endpoint exposes config + corpus stats

#### Health & Recovery
- **Daemon health probe** — `/health?probe=true` verifies provider is actually reachable
- **Auto-recovery** — Detects provider failure, attempts re-warmup with retry backoff
- **Graceful degradation** — Returns `{"continue": true}` when provider down instead of blocking

### 🛠️ Management & Workflow

#### Skills (26 total)

**Setup & Configuration:**
- `/contextus-setup` — First-run setup: scaffold `.claude/context/`, register in CLAUDE.md, initial embed
- `/configure` — Interactive config editor for `.claude/contextus.jsonc`
- `/migrate-memory` — Convert `.claude/memory/` (old format) → `.claude/context/` (new)

**Content Creation:**
- `/create-context` — Capture a new pattern with frontmatter validation
- `/create-doc` — Create a documentation file in `docs/` with auto-indexing
- `/add-patterns` — Batch-add multiple patterns from a list
- `/tag-context` — Add/manage tags on context files (v2-ready infrastructure)
- `/update-context` — Edit existing context files

**Status & Health:**
- `/context-status` — Dashboard: corpus stats, recent activity, calibration quality
- `/context-status --cost` — Token overhead % + value signal (usage rate from calibration)
- `/context-doctor` — Troubleshooting guide (checks daemon, provider, corpus health)
- `/contextus-watch` — Live tail of daemon activity (colored, formatted)

**Maintenance:**
- `/rebuild-embeddings` — Force re-embed (incremental by default, `--full` for complete rebuild)
- `/audit-context` — Check for duplicates, missing frontmatter, stale patterns
- `/audit-stale` — Find zero-hit patterns (never retrieved)
- `/context-search` — Manual search over the corpus (debugging, exploration)

**Calibration:**
- `/context-calibrate` — Run floor replay or usage-eval campaign
- `/context-calibrate --floor` — Find optimal injection floor from usage logs

**Daemon Control:**
- `/manage-daemon` — Stop, start, restart daemon (needed after config changes)

**Aliases:**
Primary skills have `/ctx-*` aliases for brevity:
- `/ctx-setup` → `/contextus-setup`
- `/ctx-status` → `/context-status`
- `/ctx-calibrate` → `/context-calibrate`
- `/ctx-doctor` → `/context-doctor`
- `/ctx-watch` → `/contextus-watch`
- `/ctx-create` → `/create-context`
- `/ctx-tag` → `/tag-context`
- `/ctx-migrate` → `/migrate-memory`

#### Automatic Hooks

**SessionStart:**
- Auto-starts daemon (first launch installs deps)
- Checks provider health, reports if down
- Loads project + user memory indexes

**UserPromptSubmit:**
- Queries daemon for relevant context
- Injects formatted results with provenance footer
- Logs retrieval event (patterns, scores, latency)

**FileWrite (context files only):**
- Triggers incremental re-embed on `.claude/context/**/*.md` writes
- Notifies daemon of file change via `/notify` endpoint

**SessionEnd (optional):**
- Usage evaluation (post-prompt Stop hook — v2)

### 📝 Content Management

#### Frontmatter Schema
All context files use YAML frontmatter:
```yaml
---
name: kebab-case-identifier
description: One-line summary (used for relevance matching)
metadata:
  type: decision | gotcha | implementation | reference | project | feedback | question
  tags: [optional, list]
---
```

#### Multi-Source Architecture
- **Project context** — `.claude/context/` (team patterns, git-committed)
- **Project docs** — `docs/` (long-form documentation, indexed by DOCS.md)
- **User context** — `~/.claude/context/` (personal patterns, cross-project)
- **User docs** — `~/.claude/docs/` (personal documentation)

#### Storage
- **Embeddings** — `~/.contextus/data/<project-name>/` (per-user, per-project LanceDB)
- **Logs** — `~/.contextus/logs/` (usage.jsonl, errors.jsonl, paranoid.jsonl, daemon.log)
- **Runtime state** — `~/.contextus/runtime/` (daemon.pid, daemon.port)

### 🔧 Configuration

#### Hot-Reload
Config changes take effect immediately — no daemon restart needed. Edit any of:
- `plugin.jsonc` (plugin defaults)
- `~/.contextus/data/<project>/config.json` (per-project overrides)
- `.claude/contextus.jsonc` (git-committed overrides, highest precedence)

#### JSONC Support
All config files support comments and trailing commas. The system strips JSONC before parsing.

#### Key Config Options

**Retrieval:**
- `topK` — Number of patterns to retrieve (default: 5)
- `injectionFloor` — Minimum similarity to inject (default: 0.45)
- `maxTokens` — Token budget for injected context (default: 3000)
- `hybrid` — Hybrid search mode: `always` or `off` (default: `always`)
- `provenanceFooter` — Show "Context: used:" footer (default: `true`)

**Expansion:**
- `mode` — Query expansion: `adaptive`, `always`, or `off` (default: `adaptive`)
- `expansionThreshold` — Trigger expansion when best score < threshold (default: 0.55)
- `maxVariants` — Number of alternate phrasings (default: 3)
- `provider` — LLM for expansion: `ollama` or `bedrock` (default: `ollama`)
- `timeoutMs` — Total timeout for expansion (default: 5000)

**Embedding:**
- `provider` — `ollama` (recommended) or `transformers` (in-process)
- `model` — Embedding model identifier
- `dimensions` — Vector dimensions (must match model, default: 768)

**Sources:**
- `projectContext.enabled` — Enable project `.claude/context/` (default: `true`)
- `projectDocs.enabled` — Enable project `docs/` (default: `true`)
- `userContext.enabled` — Enable user `~/.claude/context/` (default: `true`)
- `userDocs.enabled` — Enable user `~/.claude/docs/` (default: `true`)

### 🏗️ Architecture

#### Daemon
- **Single shared instance** — One daemon across all projects, model loaded once
- **Project isolation** — Per-project LanceDB dir, config merging
- **HTTP API** — Localhost-only server (default port: 37800)
- **Auto-start** — SessionStart hook spawns daemon if not running
- **Node stdlib** — No framework dependencies in hot path

#### Endpoints
- `GET /health` — Liveness + readiness (modelLoaded, warmupError, expansion stats)
- `GET /health?probe=true` — Active health check (verifies provider reachable)
- `GET /novelty?project=<path>` — Recently-injected patterns (for awareness hook deduplication)
- `GET /introspect?project=<path>` — Config + corpus stats + hit tracking
- `POST /query` — Main retrieval: embed → search → rerank → floor → inject
- `POST /notify` — File change notification: triggers incremental re-embed
- `POST /reconcile` — Corpus sync: add new, update changed, remove deleted

See [API.md](./API.md) for comprehensive endpoint documentation.

#### Retrieval Pipeline
```
UserPromptSubmit hook
  ↓
POST /query {project, prompt}
  ↓
embed prompt (with keyword fallback on failure)
  ↓
vector search (with hybrid fusion if enabled)
  ↓
multi-vector expansion (if adaptive/always + score < threshold)
  ↓
rerank (collapse by file, dedup)
  ↓
injection floor (drop below threshold)
  ↓
format with provenance footer
  ↓
return {continue, hookSpecificOutput: {additionalContext}}
```

### 🔐 Privacy & Security

- **Local-first** — Ollama embedding runs on localhost, no external API calls
- **Per-user storage** — Embeddings in `~/.contextus/data/`, not git-committed
- **Transparent logs** — All retrieval events logged for audit
- **Optional providers** — Choose Ollama (local) or Bedrock (AWS) per your needs

## Future Features (v2 Roadmap)

See [docs/dev/V2_ROADMAP.md](dev/V2_ROADMAP.md) for the full v2 backlog. Highlights:

- **Usage-driven curation** — Auto-remove zero-hit patterns, promote high-value ones
- **Tag-based retrieval** — Filter by tags during search
- **Web console** — Visual corpus explorer, embedding space visualization
- **Injection templates** — Format control (dense vs. verbose, with/without provenance)
- **Cross-project learning** — Personal patterns automatically available everywhere
- **Compression optimization** — Token-efficient injection formats

## Comparison to Alternatives

**vs. Manual search (grep/find):**
- Automatic (no queries)
- Semantic (finds by meaning, not keywords)
- Multi-source (project + user patterns/docs)

**vs. Traditional RAG:**
- Proactive (not on-demand)
- Calibrated (learns what's useful)
- Graceful degradation (keyword fallback, no-inject is success)

**vs. Claude-native memory:**
- Explicit (file-based, git-trackable)
- Team-friendly (shared patterns in `.claude/context/`)
- Tunable (floor, top-k, hybrid mode)

## Performance

- **Embedding latency** — ~100-400ms (Ollama, nomic-embed-text on M4 Pro)
- **Vector search** — ~40-60ms (LanceDB, 700-chunk corpus)
- **Keyword scan** — ~10-20ms (BM25 over 700 chunks)
- **Hybrid overhead** — ~20ms (keyword runs parallel to vector)
- **Expansion latency** — ~100-500ms (qwen2.5:3b on Ollama, adaptive mode)
- **Re-embed (incremental)** — ~1-2s per file (background, non-blocking)

All timings on M4 Pro 48GB.

## Support

- **Issues** — [GitHub Issues](https://github.com/anthonypdawson/claude-contextus/issues)
- **Docs** — [docs/](.) directory (quick-start, migration guide, design docs)
- **Self-help** — `/context-doctor` for troubleshooting, `/contextus-watch` for live debugging
