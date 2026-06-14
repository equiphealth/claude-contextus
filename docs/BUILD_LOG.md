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
