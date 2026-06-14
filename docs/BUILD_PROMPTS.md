# Build Kickoff Prompts

Copy-paste prompts to drive the claude-contextus v1 build, one per `/clear` cycle. Each maps to a phase in [IMPLEMENTATION_ESTIMATE.md](IMPLEMENTATION_ESTIMATE.md) and stops at a verification seam (see that doc's "How to Run the Build" cadence).

**How to use:** `/clear`, paste the next prompt, let it run to the stop, verify what it flags, then `/clear` and paste the next. The project `MEMORY.md` and `docs/DOCS.md` indexes auto-load each session, so later prompts stay short.

**Six prompts, four genuine decision points (1, 2, 3, 5).**

**Standing instruction (every prompt), in order at the stop:**
1. Read [`docs/BUILD_LOG.md`](BUILD_LOG.md) for the entry template, then append a phase entry using that format (exit-criteria status, what changed, verified vs. needs-user-verification, DESIGN.md divergences, decisions applied, token/cost).
2. **Commit** all phase changes (including the BUILD_LOG entry) with a descriptive message, then **push**.
3. Give the same summary in chat.

The doc is the durable record; chat is the convenience copy. Commit/push at every stop so each `/clear` starts from a clean, pushed tree.

---

## ▶ Prompt 1 — Phase 0: Demolition & Foundation

> Starting the claude-contextus v1 build. First read `docs/IMPLEMENTATION_ESTIMATE.md` (the phased plan + "How to Run the Build" cadence) and the `design-scoping-v1-v2`, `build-execution-cadence`, and `selfdoc-build-practice` memories so you have the constraints.
>
> Then do **Phase 0 only**: replace the ChromaDB client with a LanceDB client, create `scripts/`, lock embedding config to Transformers.js + nomic (config-driven), and fix the stale `plugin.json` values (`chroma`→`lancedb`, model→nomic, note the unvalidated `similarityThreshold: 0.7`).
>
> **The critical task is verifying the real `@lancedb/lancedb` API matches what DESIGN.md assumes** — this is the highest-risk unknown. If it diverges, stop and tell me before writing more.
>
> Also set up linting/formatting: add `.prettierrc` + `.eslintrc.js` configs, wire `pnpm lint` and `pnpm format` scripts in `package.json`. Run both before reporting.
>
> Exit criteria: `lib/lance-client.ts` connects, creates a table, round-trips one record; linting/formatting is configured and passing. Then stop, append a Phase 0 entry to `docs/BUILD_LOG.md` (use the template there) and report the same in chat: what you verified vs. what I should check, any DESIGN.md divergence, and input/output token counts with estimated cost (Opus 4.8: $15/M input, $75/M output; estimate cache hit rate).

---

## ▶ Prompt 2 — Phase 1: Embedding Pipeline

> Phase 0 is done and committed. Read `docs/IMPLEMENTATION_ESTIMATE.md` (Phase 1) and the `selfdoc-build-practice` memory.
>
> Do **Phase 1 only**: `lib/embedder.ts` (Transformers.js nomic, mean pooling + normalize, model warm-load) and `scripts/embed-contexts.js` (scan sources, whole-doc embed — defer chunking, store model + dimensions in metadata). Parse and persist `metadata.type` + `tags` from frontmatter per chunk; `type` will feed the re-ranker, `tags` are stored-but-unused until v2. Reject files whose prefix and `metadata.type` disagree.
>
> Exit criteria: `npm run embed` populates LanceDB from real `.claude/context/`; rows carry `type` + `tags`; vector-inspector can open the DB.
>
> **Note on the corpus**: the context files you embed *become the injected corpus* — write/verify any context files from confirmed code or tests, not from memory (per `selfdoc-build-practice`).
>
> Before reporting: run `pnpm lint && pnpm format`.
>
> Stop, append a Phase 1 entry to `docs/BUILD_LOG.md` (template there) and report the same in chat; I'll spot-check the embedded content is true before it hardens. Include input/output token counts with estimated cost.

---

## ▶ Prompt 3 — Phase 2: The Spine (Daemon + Query Hook) ← the demo

> Phase 1 is done and committed. Read `docs/IMPLEMENTATION_ESTIMATE.md` (Phase 2) and `docs/DESIGN.md` for the daemon/retrieval contracts.
>
> Do **Phase 2 only** — the spine: `daemon/server.js` (`/health` with `modelLoaded`, `/query`, `/notify`; model loaded once), `scripts/session-start-hook.js` + an `ensureDaemonRunning()` util (poll `/health`, don't sleep), `scripts/query-hook.js` (thin HTTP client, graceful degradation if daemon down), and the re-ranker (`typeBoost` reads `metadata.type`) + injection floor + injection format block. Log every floor-dropped chunk with its score (groundwork for v2 removal).
>
> Before reporting: run `pnpm lint && pnpm format`.
>
> Exit criteria: a real prompt in a live session injects relevant context. **I will drive a live Claude Code session to verify this — you can't self-verify it**, so when you reach the exit, append a Phase 2 entry to `docs/BUILD_LOG.md` (template there), then stop and tell me exactly how to test it (commands, what to look for in the injected block). Flag any daemon spawn/detach issues you hit. Report input/output token counts with estimated cost.

---

## ▶ Prompt 4 — Phases 3 + 4: Capture, Incremental Updates, Unit Tests + `/migrate-memory`

> Phase 2 (the spine) is verified and committed. Read `docs/IMPLEMENTATION_ESTIMATE.md` (Phases 3–4 + the "Memory → Context Migration" section) and the `memory-to-context-migration` memory.
>
> Do **Phases 3 and 4 together**:
> - Phase 3: `scripts/awareness-hook.js` (proposal footer, novelty signal from the injected set), `scripts/watch-contexts.js` (PostToolUse → `/notify` → incremental re-embed), hit-count tracking on retrieval.
> - Phase 4: pure-logic unit tests for re-ranker, floor, chunker, staleness, formatter, dedup; wire `npm test`.
> - Build the **`/migrate-memory` skill** (dry-run by default, idempotent, verify-before-embed): converts `.claude/memory/` slug files → `.claude/context/` prefix files with inferred `type` + seed `tags`, and repoints the `plugin.json` source path. The pipeline exists now, so this is the right time. Don't run it on real data yet — just build + test it.
>
> Before reporting: run `pnpm lint && pnpm format`.
>
> Exit criteria: editing a context file re-embeds without a full rebuild; proposals appear in footers; green test suite (<5s, no model load). Then stop, append a Phases 3+4 entry to `docs/BUILD_LOG.md` (template there), and report input/output token counts with estimated cost.

---

## ▶ Prompt 5 — Phase 5: Quality Measurement

> Phases 3–4 are done and committed. Read `docs/IMPLEMENTATION_ESTIMATE.md` (Phase 5), `docs/LOGGING.md`, and the `evaluation-architecture` + `ollama-model-quality` memories.
>
> Do **Phase 5 only**: wire the Stop hook + eval worker (Haiku calibration — test the *parser*, mock the model call), build the floor-calibration harness (replay historical prompts, log the similarity distribution), and add a minimal `/introspect` endpoint (version, model + dimensions, loaded packs, chunk counts, floor, re-rank weights, hit-count stats, uptime) that feeds `/context-status`. Defer `generate-docs` and the 7 auto-doc files to v2.
>
> Before reporting: run `pnpm lint && pnpm format`.
>
> Exit criteria: a calibration run produces a floor recommendation **from my real historical prompts** — so when ready, append a Phase 5 entry to `docs/BUILD_LOG.md` (template there), then stop and tell me how to run it; I need to eyeball whether the recommended floor is sane before we adopt it. Report input/output token counts with estimated cost.

---

## ▶ Prompt 6 — Phase 6: Hardening

> Phase 5 is done and committed. Read `docs/IMPLEMENTATION_ESTIMATE.md` (Phase 6).
>
> Do **Phase 6**: daemon crash recovery, stale-PID cleanup, integration tests for daemon + hooks, model/dimension validation fail-fast paths.
>
> Before reporting: run `pnpm lint && pnpm format`.
>
> Exit criteria: kill the daemon mid-session → the next prompt recovers gracefully. Run the migration for real (`/migrate-memory`) once everything's green, then append a Phase 6 entry to `docs/BUILD_LOG.md` (template there) and give me a final v1 status: what works, what's deferred to v2, anything that diverged from DESIGN.md along the way, and input/output token counts with estimated cost.

---

## After the build

- **v2 backlog** (CAE gate, tag-driven gating, per-category retrieval config, removal/governance, full Layer-1 auto-docs) lives in `IMPLEMENTATION_ESTIMATE.md` → "v2 Backlog".
- **Live open questions** to revisit: CAE cost model, floor-vs-CAE authority, hard-override provenance, auto-doc namespace. Same doc.
