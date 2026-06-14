# Build Log

Per-phase completion summaries for the claude-contextus v1 build. One entry per phase, appended at each stop seam (see [BUILD_PROMPTS.md](BUILD_PROMPTS.md) cadence). This is the durable record of **what was actually built and verified** — distinct from [IMPLEMENTATION_ESTIMATE.md](IMPLEMENTATION_ESTIMATE.md) (the *plan*) and commit messages (the *rationale*).

**Entry template** (every phase fills this in):

```markdown
## Phase N — <title> (<date>)

**Exit criteria — status:** <met / partially met, with what's outstanding>

**What changed:**
| File | Change |
|---|---|
| ... | ... |

**Verified (ran, not assumed):** <commands run + results>

**Needs user verification:** <what only the user can confirm — live session, data, judgement>

**DESIGN.md divergences:** <none, or list with file:line>

**Decisions applied:** <user decisions folded in this phase>

**Token/cost:** <input/output token estimate + cost at Opus 4.8 rates, note cache assumption>
```

---

## Phase 0 — Demolition & Foundation (2026-06-14)

**Exit criteria — status:** ✅ Met. `lib/lance-client.ts` connects, creates a table, and round-trips a record — verified by running `scripts/verify-lance.ts` against the real `@lancedb/lancedb@0.30.0` (14/14 assertions pass). Lint/format configured and passing; type-check clean on all new files.

**What changed:**
| File | Change |
|---|---|
| `lib/lance-client.ts` | **New** — real LanceDB API (connect/createTable/search/mergeInsert); JSON sidecar for model/dimension provenance |
| `lib/config.ts` | **New** — embedding locked to `nomic-ai/nomic-embed-text-v1.5` (768-dim), config-driven (reads `plugin.json`) |
| `scripts/verify-lance.ts` | **New** — Phase-0 round-trip proof using synthetic vectors (isolates LanceDB API risk from the model download) |
| `lib/chroma-client.ts` | **Deleted** — no code imported it |
| `plugin.json` | `chroma`→`lancedb`; model→`nomic-ai/nomic-embed-text-v1.5` (+`dimensions: 768`); annotated unvalidated `similarityThreshold: 0.7` |
| `tsconfig.json` | `ignoreDeprecations: "6.0"`→`"5.0"` (was breaking `tsc` entirely) |
| `.eslintrc.cjs` | **New** — ESLint 8 legacy config (`.cjs` because `package.json` is `type: module`) |
| `.prettierrc` | **New** — formatter config |
| `package.json` | `lint` scoped to `lib scripts` |
| `.claude/context/implementation/lancedb-api-surface.md` | **New** verified context note + CONTEXT.md index entry |

**Verified (ran, not assumed):**
- `pnpm exec tsx scripts/verify-lance.ts` → 14/14 assertions: create, count, sidecar, search round-trip (self-similarity 1.0000), upsert update-in-place, upsert insert-new, filtered `where` search
- `pnpm lint` → clean
- `pnpm exec tsc --noEmit` → clean on all new files (pre-existing errors only in salvage files `embedder.ts`/`context-loader.ts`, which Phase 1 rewrites)

**Needs user verification:** Nothing blocking — Phase 0 is fully self-verifiable. Open decisions were resolved live (tsconfig fix, sidecar, tags-as-string).

**DESIGN.md divergences** (the high-risk unknown — it diverged; all confined to the storage layer; captured in `lancedb-api-surface.md`):
1. `new LanceDBClient()` / `getOrCreateCollection()` / `collection.metadata()` (DESIGN.md:~1421) — ChromaDB-shaped, **do not exist** in `@lancedb/lancedb`. Real API: `connect → createTable/openTable`.
2. `.execute()` is `protected` in v0.30 — public query terminal is `.toArray()`. `poc/ingest-test.ts:129` uses `.execute()` and would throw (predates this version).
3. LanceDB has **no collection-level metadata** (Chroma did) — model/dimension provenance moved to a JSON sidecar (`contextus.meta.json`). DESIGN.md's validation logic survives, just reads the sidecar.

**Decisions applied:** tsconfig fixed (`5.0`); sidecar kept for provenance; `tags` stored as comma-joined string; verified context note saved; automation lint-script port deferred to Phase 1.

**Token/cost:** ~95K input (dominated by CLAUDE.md + SessionStart + doc reads replayed each turn), ~14K output. With Claude Code prompt caching (most input is cache reads ~$1.50/M after turn 1), realistic **~$1.50–2.50**. Rough, not metered — cache hit rate is the swing factor.

---

## Phase 1 — Embedding Pipeline (2026-06-14)

**Exit criteria — status:** ✅ Met (with a provider divergence — read the divergences section). `pnpm run embed` populates LanceDB from the real `.claude/context/` (3 rows, 768-dim); every row carries `type` + `tags`; provenance sidecar records the provider. vector-inspector can open the DB — confirmed by running VI's own `lancedb_connection.py` stack headlessly (`list_tables` → `['contextus']`, `open_table` → 3 rows, all 9 columns present). **The GUI open itself is still yours to confirm** (I can't drive a GUI).

**What changed:**
| File | Change |
|---|---|
| `lib/embedder.ts` | **Rewrote** (was MiniLM/JS salvage) — TS, provider-abstracted (`transformers` \| `ollama`), mean-pool + L2-normalize, `getEmbedder` warm-load with shared in-flight promise, `warmup()` dim-validation fail-fast. nomic task prefixes (`search_document:` / `search_query:`) via `embedDocument`/`embedQuery` so doc/query sides can't drift; `CONTEXTUS_NOMIC_PREFIXES=0` to disable |
| `lib/context-loader.ts` | **Rewrote** — typed, strict-clean. Accepts both top-level (`type:`) and nested (`metadata.type:`) frontmatter (corpus is mid-migration); normalizes `tags` (list \| csv \| absent → `string[]`). `findPrefixTypeMismatches` rejects files whose known category prefix disagrees with `type` |
| `scripts/embed-contexts.ts` | **New** — scans `.claude/context/`, whole-doc embed (one row/file, chunking deferred), embeds `name+description+body` but stores body as `document`, full table rebuild, prefix↔type gate before embedding, type/tag summary |
| `lib/config.ts` | Added `EmbeddingProvider` + `provider`/`ollamaModel`/`ollamaEndpoint` fields; code default stays `transformers` |
| `lib/lance-client.ts` | `TableMeta` gains `provider`; `createTable` stamps the active provider + resolved model id into the sidecar |
| `plugin.json` | `embedding.provider: "ollama"` (annotated) + ollama fields — see divergence #1 |
| `package.json` | `embed`/`rebuild` now run via `tsx` (not `npm run build && node dist/…` — matches Phase 0, sidesteps the dist config-path issue); `test` → `tsc --noEmit && node --test`; **`format` scoped to `lib`/`scripts`/root json** (was repo-wide `**/*` — it reflowed 25 unrelated docs/memories; added `format:all` for the rare full pass) |
| `.eslintrc.cjs` | Dropped `embedder.ts`/`context-loader.ts` from the salvage override (now full rewrites, lint-clean) |

**Verified (ran, not assumed):**
- `pnpm exec tsc --noEmit` → clean across all files
- `pnpm lint` → clean; `pnpm format` → clean
- `pnpm run embed` → 3 rows, `by type: decision=1, implementation=1, reference=1`, 1/3 tagged
- Round-trip read: all rows carry 768-dim vectors, correct `type`, tags persisted (`lancedb,vector-db,api,phase-0`)
- Retrieval sanity (query `"how does the lancedb vector store api work"`): top hit is `lancedb-api-surface.md` @ **sim 0.4552**, others @ ~0.09 — clean separation, asymmetric prefixes working
- vector-inspector lancedb stack opens the DB headlessly (see exit criteria)

**Needs user verification:**
- **Open the DB in the vector-inspector GUI** (`~/.contextus/data/claude-contextus`, lancedb provider) — I verified the library stack, not the GUI.
- **Spot-check the embedded corpus is *true*** before it hardens (per `selfdoc-build-practice`): only 3 files exist on disk (`decisions/proactive-ux-positioning.md`, `implementation/eslint-rules.md`, `implementation/lancedb-api-surface.md`). `CONTEXT.md` indexes ~5 more that **don't exist yet** (design/embedding-model-choice, design/daemon-architecture, decisions/storage-location, implementation/promise-handling-rules) — aspirational index entries, not a pipeline bug.
- **Sanity-check the provider divergence below** is acceptable.

**DESIGN.md divergences:**
1. **Embedding provider is Ollama, not Transformers.js — forced by the network, not preference.** The corporate **Cloudflare Gateway blocks all Hugging Face model downloads**: HF resolve URLs (and the hf-mirror.com fallback) return an HTML block page instead of the ONNX weights, so `@xenova/transformers` can't fetch nomic. (A *first* hurdle — a self-signed corporate root in the TLS chain — was cleared via `NODE_EXTRA_CA_CERTS`; the CDN block is a network policy, not code-fixable.) The locally-cached HF models are PyTorch (sentence-transformers), not the ONNX transformers.js needs. **Ollama already had `nomic-embed-text` pulled** (768-dim, `nomic-bert`, same model family), runs over localhost, and bypasses the block. DESIGN.md §"Embedding Providers" lists Ollama as a first-class provider with exactly this model, so this is *within* the design envelope — but the v1 **default** flips from transformers→ollama in the deployed `plugin.json`. The code default stays `transformers`; the provider is recorded in the sidecar so Phase 2's daemon validates query-time against build-time. **If you'd rather pursue an allow-listed HF path, the transformers branch is intact and one config flip away (then re-embed).**
2. **nomic task prefixes added** (not in DESIGN.md's `pipeline(...)` snippet at :392, which omits them). They're the model author's documented asymmetric-retrieval usage and measurably help (query↔related 0.68 vs query↔unrelated 0.39 in a raw Ollama check). Trivially reversible via env.

**Calibration signal (for Phase 5, not acted on now):** top retrieval similarity was **0.4552**, well under the unvalidated `0.7` floor — with `search_query`/`search_document` prefixes and an Ollama (GGUF) nomic, the similarity distribution sits lower than the 0.7 default assumes. This is exactly what the Phase 5 floor-calibration harness exists to set from real data. Flagging, not changing.

**Decisions applied:** whole-doc embed (chunking deferred per estimate); embed `name+description+body`, store body only; prefix↔type gate is advisory-strict (only flags files that have *both* a known prefix and a conflicting declared type); `format` scope narrowed to stop cosmetic churn polluting phase commits.

**Token/cost:** ~140K input (CLAUDE.md + SessionStart + Phase docs + salvage/config reads replayed each turn; the network-debugging detour added turns), ~22K output (3 source files + this entry). At Opus 4.8 rates with Claude Code caching (most input is cache reads ~$1.50/M after turn 1), realistic **~$2.50–4.00**. Rough, not metered — the HF-block investigation was the main cost-add over the estimate's ~45min ideal.
