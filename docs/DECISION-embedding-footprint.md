# Decision: Embedding Footprint Trade-offs

_Last updated: June 10, 2026_

## Context

Contextus requires an embedding model for semantic memory search. The choice impacts:

- Plugin download size
- First-run initialization time
- Runtime memory footprint
- Offline capability

## Options Considered

### 1. Transformers.js (In-Process, Default)

**Pros:**

- ✅ Works offline (no external services)
- ✅ No server/daemon required
- ✅ Deterministic (same model, same results)
- ✅ Fast queries (~50-100ms)
- ✅ Small models available (~80MB for all-MiniLM-L6-v2)

**Cons:**

- ⚠️ Adds ~90MB total footprint (package + model)
- ⚠️ First-run model download (~20s)
- ⚠️ Uses CPU (not GPU-accelerated in Node.js)

**Footprint:**

- Package: ~5MB (`@xenova/transformers`)
- Model cache: ~80MB (all-MiniLM-L6-v2) or ~138MB (nomic-embed-text)
- Total: ~85-143MB

### 2. Ollama (Opt-in Enhancement)

**Pros:**

- ✅ Higher quality embeddings
- ✅ GPU acceleration (if available)
- ✅ User controls lifecycle

**Cons:**

- ❌ Requires Ollama running (external dependency)
- ❌ Not available on all systems
- ❌ Slower if not GPU-accelerated (~200ms vs 50ms)

**Footprint:**

- Plugin: 0MB (user installs Ollama separately)
- Model: ~274MB (nomic-embed-text, managed by Ollama)

### 3. Claude Semantic Matching (Fallback)

**Pros:**

- ✅ No embedding model needed
- ✅ Understands natural language nuance
- ✅ Always available (if Claude API accessible)

**Cons:**

- ❌ Requires API call (~2-5s latency)
- ❌ Token cost per search
- ❌ Doesn't work offline

**Footprint:**

- Plugin: 0MB (uses existing Claude API)

### 4. Keyword-Only (Ultimate Fallback)

**Pros:**

- ✅ Zero dependencies
- ✅ Instant (~10ms)
- ✅ Works everywhere

**Cons:**

- ❌ No semantic understanding
- ❌ Misses synonyms and related concepts

**Footprint:**

- Plugin: 0MB (plain grep)

## Decision

**Default: Transformers.js** with automatic fallback hierarchy.

### Rationale

1. **Offline-first matters.** `.claude/memory/` is for project knowledge that should work without network.

2. **90MB is acceptable** for the value delivered:
   - TypeScript LSP plugin: ~200MB (ships full language server)
   - VS Code: ~300MB base installation
   - Any browser-based plugin: ~100MB+ (Chromium)

3. **Users who care about size** can:
   - Disable the plugin (keep manual `MEMORY.md` index)
   - Use `--no-embeddings` mode (keyword-only)
   - Wait for lazy-load implementation (download model on first search)

4. **CPU performance is fine** for <200 documents:
   - Initial index: ~20s one-time cost
   - Incremental updates: ~0.1s per changed file
   - Query: ~55ms per search

### Implementation Strategy

**Phase 1 (MVP)**: Ship with Transformers.js, no lazy-loading

- User gets full semantic search out of box
- Model downloads on plugin install (one-time)

**Phase 2 (Optimization)**: Add lazy-loading

- Ship plugin without model (~5MB)
- Download model on first search invocation
- Show progress: "Downloading embedding model (80MB)... 45%"

**Phase 3 (Advanced)**: Optional lite mode

- `"embedding": { "provider": "keyword" }` skips model entirely
- Falls back to grep-based search (no semantics, but fast)

## Alternative Considered: External Service

We considered requiring users to run a separate embedding service (like Ollama), but rejected because:

- **Barrier to entry**: Most users won't install external services for one feature
- **Fragility**: Service crashes → memory search breaks
- **Complexity**: Now users need to manage service lifecycle

Transformers.js is "just JavaScript" — it works as long as Node.js works.

## Comparison to Similar Tools

| Tool           | Footprint | Approach                        |
| -------------- | --------- | ------------------------------- |
| **Contextus**  | ~90MB     | Transformers.js (in-process)    |
| TypeScript LSP | ~200MB    | Full language server (tsserver) |
| Cursor IDE     | ~300MB    | Embeddings + model runtime      |
| GitHub Copilot | ~150MB    | Model + runtime                 |
| claude-mem     | ~10MB     | No embeddings (keyword search)  |

Contextus is lighter than most AI-assisted dev tools while providing semantic search.

## Future Enhancements

1. **Model selection**: Let users choose smaller models (e.g., `DistilBERT-base` at 50MB)
2. **Quantization**: Ship 8-bit quantized models (~40MB vs 80MB)
3. **Streaming download**: Show progress during first-run model download
4. **Shared cache**: If multiple projects use Contextus, share one model cache

## Related

- `docs/DESIGN.md` - Full embedding provider hierarchy
- `lib/embedder.ts` - Embedding implementation
- `.embeddings/` - Model cache location

---

**Status**: ✅ Decided — ship with Transformers.js as default, 90MB footprint accepted for offline semantic search
