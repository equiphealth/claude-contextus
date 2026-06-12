# claude-contextus: Design Review Addendum

_Date: June 11, 2026_
_Source: Design review conversation with Claude Sonnet 4.6_

This document captures decisions, corrections, and new directions that emerged from a full review of DESIGN.md. Treat these as amendments to the original design — where they conflict, this document takes precedence.

---

## 1. Resolve the Git vs `~/.claude/` Contradiction

**Issue:** The document contains two conflicting ChromaDB storage strategies:

- “Git Integration” section: commit `.claude/context-db/` to the project repo
- “ChromaDB Location” section: store DBs in `~/.claude/contextus/data/{project}/`

**Decision:** The `~/.claude/contextus/data/` model wins. Remove or explicitly mark the git-committed DB section as superseded.

**Rationale:** Binary SQLite merge conflicts are a real operational problem. The per-user, per-project DB in user space avoids them entirely, keeps project directories clean, and is the correct separation of derived artifact from source.

---

## 2. Awareness Hook: Revise Trigger Wording

**Issue:** “For substantial responses” is doing too much filtering. Claude consistently under-triggers context pattern proposals because it judges most responses as not substantial enough.

**Preference:** More noise is acceptable. Missing a pattern-worthy exchange is worse than a false positive, since `/create-context` handles deduplication via similarity checking.

**Revised instruction (replace existing awareness hook echo):**

```
Unless this response is purely trivial (e.g. a one-line answer, yes/no, or acknowledgment),
append footer: Context: propose: topic-name if ANY new pattern, detail, or context was
discussed. Omit only if truly nothing reusable was covered.
```

**Key changes:**

- Opt-out framing instead of opt-in — default is to propose, not skip
- “ANY new detail” casts a wider net than “substantial”
- Explicit trivial examples remove Claude’s wiggle room
- Removes “CRITICAL” / “MUST” imperative language which causes awkward behavior

**Note:** The every-prompt injection approach is validated and working. The mechanism is correct; only the wording needs updating. Retain universal `.*` matcher coverage — limiting to context-retrieval hits would miss the primary use case of new knowledge being explained conversationally.

---

## 3. Embedding Model: Pin and Validate

**Issue:** `plugin.json` specifies `Xenova/all-MiniLM-L6-v2` but the env var documentation shows `text-embedding-3-small`. These are different embedding spaces and cannot be mixed.

**Decision:** Commit to one model before building the pipeline. Recommendation: `all-MiniLM-L6-v2` for zero-dependency local operation, but benchmark against `all-mpnet-base-v2` (512 token context vs 256) or `voyage-code-2` (better for code-adjacent content) before committing.

**Action required:** Store the model name in Chroma collection metadata and validate on every query that the model matches. A model swap without a full re-embed will silently return garbage results.

---

## 4. Document Chunking Strategy

**Decision (confirmed):** Docs will be chunked. Longer context patterns may be chunked depending on length. Standard context patterns are typically short enough to embed whole.

**Rationale for chunking docs:** `all-MiniLM-L6-v2` has a 256-token context window and will silently truncate longer content. Chunking with overlap (e.g. 512-token chunks, 64-token overlap) is the correct approach for longer documents.

**Impact on data model:** Chunked results need additional metadata fields:

- `parent_file` — original source file path
- `chunk_index` — position within the document
- `chunk_total` — total chunks for that file

`formatContextForInjection` must handle chunked results differently from whole-file results — either return the chunk directly or use it to load and inject the parent doc depending on context size.

---

## 5. Fix `query-hook.js` Result Destructuring Bug

**Issue:** The pseudocode has a bug — `results[i]` doesn’t exist. Chroma returns results as parallel arrays under `ids`, `documents`, `metadatas`, `distances`.

**Corrected pattern:**

```javascript
const relevant = results.distances[0]
  .map((dist, i) => ({
    id: results.ids[0][i],
    document: results.documents[0][i],
    metadata: results.metadatas[0][i],
    similarity: 1 - dist, // cosine distance → similarity
  }))
  .filter((r) => r.similarity >= config.memoryRag.similarityThreshold);
```

---

## 6. Architecture: Daemon + HTTP Hook Pattern

**Decision:** Replace stateless Node process-per-invocation hooks with a persistent daemon serving a local HTTP API.

**Rationale:** `@xenova/transformers` model loading takes 2-5 seconds due to WASM initialization — far exceeding the <100ms latency target. A fresh Node process per hook invocation makes this unavoidable without a persistent process.

**Validated by:** The `claude-recall` plugin in the community already uses this pattern — auto-starting a worker service on `SessionStart`.

**Architecture:**

```
SessionStart hook
  → ensure daemon is running (start if not)
  → daemon loads embedding model, initializes Chroma client

UserPromptSubmit hook (thin HTTP client)
  → POST { prompt } to localhost:PORT/query
  → return { additionalContext: ... } from response

PostToolUse hook (Write|Edit, thin HTTP client)
  → POST { file, content } to localhost:PORT/notify
  → daemon triggers incremental re-embed if memory file changed
```

**Benefits:**

- Model loaded once per session, warm for all subsequent queries
- Chroma client lifecycle owned by daemon (connection pooling, caching)
- HTTP boundary = clean versioning separation between hook format and daemon logic
- Hooks become dumb thin clients — resilient to Claude Code hook API changes
- Daemon can be curled directly during development for retrieval testing without triggering Claude sessions — pairs well with vector-inspector for embedding validation

**Daemon responsibilities:**

- Model loading and warm-up
- Chroma client and collection management
- Query execution (embed → search → filter → format)
- Incremental re-embed on file change notifications
- Session state (e.g. turns-since-last-proposal counter if implementing threshold-based awareness)
- Source management (project, user, custom sources)

**Hook responsibilities:**

- Serialize event JSON
- POST to daemon
- Return daemon response to Claude Code

**SessionStart hook behavior:**

```bash
# Check if daemon running, start if not
if ! curl -sf http://localhost:PORT/health > /dev/null; then
  node $PLUGIN_PATH/daemon/server.js &
  sleep 1  # brief warm-up
fi
```

---

## 7. User Context Pattern Duplication: Note for v2

**Current design:** User context patterns are embedded into every project DB, triggering cascading rebuilds across all projects when `~/.claude/context/` changes.

**Not blocking for v1** at current scale, but worth revisiting at 10+ projects. The alternative — a shared `~/.claude/contextus/data/user/` with a union query (two Chroma calls instead of one) — eliminates cascading rebuilds at the cost of slightly more query complexity.

**Defer to v2** unless rebuild latency becomes a real pain point.

---

## 8. Debug Workflow for File Mode

**Issue:** The debugging section references `curl http://localhost:8000` which assumes Chroma server mode. No equivalent debug path exists for file mode.

**With the daemon pattern, this is resolved:** The daemon itself exposes a local HTTP API, so you can curl `localhost:PORT/query?text=...` regardless of whether the underlying Chroma storage is file-based or server-based. The daemon abstracts the storage mode from the debug workflow.

---

## 9. Semantic Motivation for RAG (Confirmed Priority)

The primary motivation for RAG is **semantic retrieval over keyword matching**, not scale. This is valid at any corpus size — at 70+ context patterns plus substantial docs, keyword mismatch is already causing real retrieval failures.

RAG is the right next step. Fix the awareness hook wording first (quick win, immediate improvement), then implement the embedding pipeline during the vacation project.

---

## Summary: Pre-Implementation Checklist

Before writing the embedding pipeline:

- [ ] Remove/supersede the git-committed ChromaDB section in DESIGN.md
- [ ] Update awareness hook wording (opt-out framing, “ANY new detail”)
- [ ] Benchmark embedding models: MiniLM vs mpnet vs voyage-code-2
- [ ] Decide on chunk size/overlap strategy for docs
- [ ] Design daemon API contract (endpoints, request/response shapes)
- [ ] Confirm `SessionStart` hook is the right place to ensure daemon is running

During implementation:

- [ ] Store embedding model name in Chroma metadata, validate on query
- [ ] Fix result destructuring in query logic (see §5)
- [ ] Implement chunked result handling in `formatContextForInjection`
- [ ] Add `/health` endpoint to daemon for hook startup check
- [ ] Wire `PostToolUse` on Write|Edit to daemon `/notify` for incremental re-embed
