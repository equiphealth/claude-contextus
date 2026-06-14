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

---

## Phase 2 — The Spine: Daemon + Query Hook (2026-06-14)

**Exit criteria — status:** ✅ **Met and live-verified.** The full spine runs end-to-end out of process over HTTP, AND a real prompt in a live Claude Code session (loaded via `claude --plugin-dir`) injected the right context — confirmed by the user. The injected instance's *thinking* explicitly referenced the block ("From the system reminders, I have a highly relevant context pattern: implementation/lancedb-api-surface.md (similarity: 0.57)... This is exactly what the user is asking about. Let me read this file.") and ended with `Context: used lancedb-api-surface.md`. This is the DESIGN.md §4.5 validation — the model *noticed, named, and used* the injection, not just received it.

**Live signal — query-shape sensitivity confirmed:** the live sentence-shaped prompt scored **0.57** vs. **0.48** for a similar curl-test query, exactly as the `floor-calibration-signals` memory predicted (real prompts trend above terse fragments). Reassuring for the permissive 0.35 floor default.

**Post-build wiring fix (commit `b74e8f7`):** initial plugin wiring would have silently failed `--plugin-dir` loading — three issues fixed after checking current Claude Code docs: (1) added the manifest at `.claude-plugin/plugin.json` (distinct from root `plugin.json`, which `lib/config.ts` reads); (2) `hooks.json` needs a top-level `"hooks"` wrapper and the env var is `${CLAUDE_PLUGIN_ROOT}`, not `$PLUGIN_PATH`; (3) removed the `PostToolUse → watch-contexts.js` wiring (Phase 3 file, would throw on every edit). `claude plugin validate` passes.

**What changed:**
| File | Change |
|---|---|
| `daemon/server.ts` | **New** — stdlib `http` daemon. `GET /health` (`modelLoaded` gates readiness), `POST /query` (spine: embedQuery→search→rerank→floor→format), `POST /notify` (incremental single-file re-embed). Model warm-loaded once *after* the socket listens (so `/health` answers `modelLoaded:false` while loading). Per-project corpus by request field; query-time provider/model validated against the sidecar; `EADDRINUSE`→defer-and-exit so a race can't double-load the model; SIGINT/SIGTERM cleanup of the PID file |
| `lib/reranker.ts` | **New** — `rerank()` = similarity × sourceWeight × typeBoost × freshnessDecay × hitCountBoost. `typeBoost` reads `metadata.type` (legacy memory types **and** new category vocab); `sourceWeight` wired but neutral until a `source` column exists. Unknown type/source → neutral 1.0 (never drops a row). Re-rank changes ORDER only |
| `lib/floor.ts` | **New** — `applyFloor()` gates on **raw** similarity (not finalScore), returns `{kept, dropped, bestScore, noInject}`. `dropped` carries the below-floor chunks for rejection logging |
| `lib/inject-format.ts` | **New** — bracketed user-message-prepend block (per `injection-format` decision), greedy token-budget trim (~4 ch/token estimate), always admits the top chunk |
| `lib/logger.ts` | **New** — dual-format (`usage.jsonl` + `daemon.log` + `errors.jsonl`) per LOGGING.md. `logRetrieval`/`logNoInject` both record `floor_dropped` (chunk + score) — the v2 governance groundwork the prompt asked for. SHA-256 prompt hash; all writes best-effort (never throw into the hot path) |
| `lib/embed-file.ts` | **New** — `embedSingleFile()`: re-embed one file + `mergeInsert` upsert (the unit behind `/notify`, shared with Phase 3's watcher). Mirrors embed-contexts' embed-text/stored-body split + prefix↔type gate; non-context files skip (no throw) |
| `lib/lance-client.ts` | Connection cache moved single→**per-project `Map`** (the shared daemon serves many projects; one global conn would pin every query to the first project) |
| `lib/config.ts` | Added **`retrieval.injectionFloor`** (default **0.35**) — a knob SEPARATE from `similarityThreshold` (DESIGN.md treats floor vs ranking as independent). Permissive default is deliberate; see calibration note |
| `plugin.json` | Added annotated `injectionFloor: 0.35` (+ reworded the `similarityThreshold` note to "ranking filter, not the gate") |
| `scripts/lib/daemon-control.js` | **New** — shared `ensureDaemonRunning()` (health-check → stale-PID cleanup → detached `tsx` spawn) + `waitForModel()` (bounded `/health` poll). Plain ESM JS (hooks have no build step) |
| `scripts/session-start-hook.js` | **New** — ensure daemon + bounded poll until warm; always emits `{continue:true}` |
| `scripts/query-hook.js` | **New** — reads UserPromptSubmit stdin payload, derives project = cwd basename, POSTs `/query`, relays the daemon's response verbatim; daemon-down → background respawn + `{continue:true}` (one missed injection, never a blocked prompt) |
| `hooks/hooks.json` | Added `SessionStart` → `session-start-hook.js` (20s timeout). `query-hook.js`/`watch-contexts.js` wiring already present |
| `package.json` | `daemon` script (`tsx daemon/server.ts`); `lint`/`format` extended to `daemon/` |

**Verified (ran, not assumed) — daemon driven over HTTP, not just imported:**
- `pnpm exec tsc --noEmit` → clean; `pnpm lint` → exit 0; `pnpm format` → clean
- **Cold `/health`** → `modelLoaded:true` within ~2s (Ollama warm-loads fast)
- **`/query` on-topic** ("how does the lancedb api work…") → injects `lancedb-api-surface.md` @ sim **0.4783**, bracketed block, **131ms**
- **`/query` off-topic** ("chocolate chip cookie recipe") → `{continue:true}`, **no injection**, logged `below_floor` best **-0.0659**, **43ms**
- **`floor_dropped` logging confirmed** in `usage.jsonl`: retrieval event recorded the 2 below-floor chunks with scores; no-inject event recorded all 3
- **`/notify`** → real context file re-embedded (`embedded:true`); non-context file skipped (`outside_context_dir`)
- **Thin hooks via stdin** (real hook contract): on-topic injects, off-topic doesn't
- **Graceful degradation**: killed the daemon → `query-hook.js` returned `{continue:true}` and fired a background respawn
- **session-start cold** → spawned + waited for warm (~0.57s); **warm** → 0.06s no-respawn; **detach confirmed** — daemon (a distinct PID) outlived the hook process

**Needs user verification (the mandatory return):**
- **Drive a live Claude Code session** and confirm a real prompt injects context (steps in my chat message). I verified the HTTP spine; I can't verify Claude actually *receives and references* the injected block — that's the §4.5 "does thinking reference the injected context?" validation DESIGN.md flags.
- **Sanity-check the floor default (0.35)** is reasonable for the demo. It's a placeholder, not calibrated (Phase 5's job) — but if it feels too permissive/strict on your real prompts, say so and I'll nudge it.

**DESIGN.md divergences:**
1. **Two thresholds are now physically separate config knobs.** DESIGN.md describes `injectionFloor` and `similarityThreshold` as distinct concepts but `plugin.json`/`config.ts` only had `similarityThreshold`. Added `injectionFloor: 0.35` as the gate; `similarityThreshold` stays as the (still-unused-in-v1) post-rank quality filter. This *implements* DESIGN.md's stated separation rather than diverging from it.
2. **Floor default is 0.35, not DESIGN.md's 0.7.** Forced by data, not preference: Phase-1 measured ollama-nomic correct hits at 0.45–0.68 with noise ~0.0–0.09 (`floor-calibration-signals` memory). A 0.7 floor would inject **nothing** and the demo would fail. 0.35 clears the noise band; the on-topic 0.4783 hit clears it, the off-topic -0.07 doesn't. Phase 5's harness sets the real value from real prompts — this is an explicit "make the spine demonstrably inject" placeholder, loudly annotated in both `config.ts` and `plugin.json`.
3. **Daemon uses Node stdlib `http`, not Express** (DESIGN.md sketches `app.get(...)`). No framework dependency added to the hot path; same endpoints.
4. **Hooks are `.js`, daemon/libs are `.ts`** — the thin/thick split DESIGN.md intends. Hooks run via bare `node` (no build step) so they can't import `.ts`; the daemon runs via `tsx` and imports the libs directly. `ensureDaemonRunning` spawns the repo-local `tsx` binary.

**Decisions applied:** injection floor separated from ranking threshold (DESIGN.md intent); floor default chosen from Phase-1 empirical data, not the doc's placeholder; stdlib http over a framework; per-project connection cache; rejection logging via `floor_dropped` on both event types.

**Daemon spawn/detach notes (the flagged-risk area):** No zombie issues hit. `detached:true` + `stdio:'ignore'` + `.unref()` cleanly outlives the hook (verified: daemon PID ≠ hook PID, survived hook exit). `EADDRINUSE` guard makes a double-spawn race safe (loser exits 0, no double model load). One thing to watch in your live run: `$PLUGIN_PATH` must resolve to this repo so `scripts/lib/daemon-control.js` finds `node_modules/.bin/tsx` (it resolves relative to its own file, so an installed-plugin path works too; `npx tsx` is the fallback if the local bin is absent).

**Token/cost:** ~165K input (CLAUDE.md + SessionStart + DESIGN.md full read + the lib/config/hook reads replayed each turn), ~30K output (7 new source files + 2 thin hooks + this entry). At Opus 4.8 rates with Claude Code caching (most input is cache reads ~$1.50/M after turn 1), realistic **~$3–5**. Rough, not metered.

### Post-verification refinements (same day, after live verification)

Spine polish prompted by the two live test sessions — still Phase 2 (no new phase). Commits `3181d31`, `e9d4ac3`, `e6ce7b0`.

| Change | File(s) | Why |
|---|---|---|
| **Source-tagged injection header** — block now leads `[contextus — retrieved from your project's context patterns…]` | `lib/inject-format.ts` | Live sessions stack ≥4 context injectors (contextus, claude-mem, lean-ctx, the memory-reminder echo hook). Without a source tag a reader can't attribute a block to contextus — a verification instance misread another injector's similarity as contextus's. The tag makes contextus's block unmistakable. Verified live: the 2nd test instance quoted contextus's 2-decimal score off its own block |
| **Daemon-state transparency** via `systemMessage` (user-facing), never `additionalContext` | `scripts/session-start-hook.js` | User preference: surface what the system did. `systemMessage` renders to the USER in the UI; using `additionalContext` would announce the daemon to Claude every session and pollute the context window contextus exists to keep clean |
| **Configurable verbosity** — `silent` / `normal` / `verbose` (heartbeat with uptime when a daemon is found) | `scripts/session-start-hook.js`, `scripts/lib/daemon-control.js`, `plugin.json`, `lib/config.ts` | Heartbeat-vs-quiet is a personal call. `config.notifications.verbosity` (deployed default **verbose**; code default `normal`); `CONTEXTUS_VERBOSITY` env override. Hooks read it from `plugin.json` directly (plain JS, no ts import); type + default single-sourced in `config.ts`. All 5 state×level combos verified |

**Live findings folded into memory** (not code): the floor's query-shape instability — the SAME off-topic doc scored **-0.075** (terse) vs **+0.39** (live phrasing), a 0.47 swing — is decisive evidence for top-K/relative-separation gating over an absolute floor in Phase 5. Recorded in the `floor-calibration-signals` memory along with the multi-injector verification hazard.

**Known edge:** `verbosity: silent` suppresses *everything*, including the daemon-failed-to-start message. Deliberate (silent means silent); revisit if failures should always punch through.

**DESIGN.md gap (tracked, not yet closed):** `injectionFloor`, `notifications.verbosity`, and the `systemMessage` transparency channel are new decisions made during the build that DESIGN.md doesn't yet describe. They're documented here, in code comments, and in commits; DESIGN.md proper should absorb them in a docs pass (candidate: alongside the Phase 5 floor calibration write-up, since the floor section is what most needs updating).
