# Implementation Estimate & Phased Approach

_Authored: 2026-06-13 by Claude (Opus 4.8). Updated 2026-06-14 to fold in the CAE, category/tag, self-documentation, and removal designs (see [CONTEXT_APPLICABILITY_EVALUATOR.md](CONTEXT_APPLICABILITY_EVALUATOR.md), [CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md), [SELF_DOCUMENTATION.md](SELF_DOCUMENTATION.md))._

**Purpose**: Honest estimate of what it takes to build claude-contextus v1 end-to-end, plus a recommended phase-based build order. Two estimate lenses are given because they answer different questions:

1. **Engineer-days** — how long a human engineer would take.
2. **AI wall-clock + token cost** — how long *I* (Claude Code) would take if told "do it now," and what that costs.

---

## What the new designs change (and don't)

Four design docs landed after this estimate was first written. The decisions on where they slot in:

| New design | v1 impact | Verdict |
|---|---|---|
| **CAE** — LLM-per-candidate applicability gate | **Deferred to v2.** The v1 gate stays the cheap similarity floor + re-ranker — no hot-path LLM call, preserving zero-latency proactive injection. CAE becomes the "advanced re-ranking" v2 item. | Floor and CAE are *both* gates; running CAE on every prompt reintroduces the per-prompt cost we deliberately pushed to background calibration. v1 keeps `retrieve → re-rank → floor → inject`. |
| **Categories & tags** | **Authored in v1, partially consumed.** Frontmatter carries `metadata.type` + `tags` from day one (cheap, future-proofs the corpus). The re-ranker reads `type` for `typeBoost`; **tags are inert until CAE exists in v2.** | Low cost, high future value. Don't defer the *vocabulary* just because its main consumer is v2. |
| **Self-documentation (Layer 1)** | **Minimal in v1:** one `/introspect` endpoint feeding `/context-status`. `generate-docs` + the 7 auto-doc files are v2 (and will live under `docs/generated/` to avoid clobbering hand-written docs). | Full auto-doc collides with hand-written `DESIGN.md` et al. and isn't load-bearing for the spine. |
| **Removal / governance** | **Concept only in v1**, with one concrete hook: the daemon **logs rejection signals** (floor drops, low-score chunks) starting now, so v2 governance has evidence to act on. Soft/hard/replacement removal mechanisms are v2. | Cheap to log now; expensive to backfill later. |

**Net effect on the spine: none.** Phases 0–2 are unchanged. The additions show up as light v1 touches (frontmatter schema, `/introspect`, rejection logging) and a fuller v2 list.

---

## Feasibility

**Verdict: clearly feasible, low research risk.**

Every component is a known quantity — Transformers.js embeddings, LanceDB file mode, an HTTP daemon, and Claude Code hooks. No novel algorithms, no "will the model even do this" gambles. The hard architectural thinking is already done (16 settled decisions, floor/threshold separation, the honest-metrics framework). What remains is mostly mechanical.

### Scaffolding reality check

DESIGN.md says "core scaffolding complete." That is generous. Actual state of the repo:

| Component | Status | Action |
|---|---|---|
| `lib/chroma-client.ts` | Still **ChromaDB**, not LanceDB | Rewrite (doc migrated to LanceDB) |
| `poc/ingest-test.ts` | Works, but uses **Ollama** embeddings | Proves pipeline, not the design default |
| `lib/embedder.ts`, `context-loader.ts`, `types.ts` | Partial | Salvageable |
| `daemon/server.js` | **Missing** (only `eval-worker.js` exists) | Build from scratch |
| `scripts/` (query, awareness, watch, session-start, embed-contexts) | **Directory does not exist** | Build all five |

So ~1,200 lines of mixed-fidelity prototype, and the load-bearing pieces (daemon, hooks, retrieval pipeline) are exactly the missing ones.

---

## Estimate 1: Engineer-Days

Mapped to DESIGN.md's own phases. Assumes a single competent engineer building it.

| Chunk | DESIGN.md phase | Estimate |
|---|---|---|
| LanceDB client + embedder (replace ChromaDB, lock nomic default) | Phase 1 core | 0.5 day |
| `embed-contexts.js` — ingest, chunk, dual-embed, model metadata | Phase 1 | 1 day |
| Daemon: `/query`, `/notify`, `/health`, model warm-load | Phase 2 | 1.5 days |
| Hooks: query, awareness, session-start, watch + `ensureDaemonRunning` | Phase 2/3 | 1 day |
| Re-rank + injection floor + format block | Retrieval | 0.5 day |
| Stop hook + eval worker wiring (Haiku calibration) | Phase 4 | 1 day |
| Floor calibration harness (replay historical prompts) | Phase 4 | 1 day |
| Glue, crash recovery, real-session debugging | — | 1 day |

**Total: ~7–8 focused engineer-days** to a v1 you'd trust on your own machine.
**Bare end-to-end demo** (embed → daemon → inject on real prompt): **~2 days.**

### Slip risks (engineer-days)
- **Daemon crash recovery** + cross-platform `spawn`/`detached` behavior. macOS detached-process and fixed-port assumptions tend to eat an afternoon of zombie-process debugging.
- v2 items (compression, LLM dedup, per-category thresholds) are correctly deferred and do not block v1.

---

## Estimate 2: AI Wall-Clock + Token Cost

This is "if you told me to do it right now and I worked straight through."

### Wall-clock

| Target | Wall-clock | Notes |
|---|---|---|
| **Spine** (one real injection working, no full test suite) | **~2 hrs** | best case if LanceDB + model load cooperate |
| **Full v1** (spine + calibration + Haiku eval + skills) | **~4–5 hrs** | without unit tests |
| **Full v1 + unit tests** | **~5–7 hrs** | tests are quick to write; cost is running the suite through the build loop |

**Where the time actually goes** (it is *not* writing code):
- Writing the code is fast — ~45 min of generation for client + embedder + daemon + 4 hooks + re-ranker + floor logic. Not the bottleneck.
- The **build/run/fix loop** is the real cost: `@xenova/transformers` first-run model download (~138MB, minutes of waiting), LanceDB API quirks vs. what the doc assumes, ESM/tsx config, daemon spawn-and-detach actually backgrounding correctly. A dozen-plus cycles, each a few minutes.
- **Driving the daemon through a tool interface** is the hardest part to verify: spawn → poll `/health` → not warm → wait → fix port → restart. Background processes are genuinely fiddly this way.

**Irreducible costs**: the embedding model's first-run download and the inherent latency of "start daemon → curl it → read logs → fix → restart." Real seconds-to-minutes per iteration regardless of typing speed.

### Token cost

A build this size is **long-horizon**: many turns, and each turn re-sends the accumulated conversation + file contents as input. That input replay — not my output — is the dominant cost.

Rough model for **full v1 + tests on Opus 4.8**:

| | Tokens | Notes |
|---|---|---|
| **Input** (cumulative across all turns) | ~3–5M | conversation replay + file reads + test output; grows each turn. Prompt caching claws back a large fraction |
| **Output** (code + messages) | ~250–400k | ~2,500 lines of code + tests |

**Cost at Opus 4.8 rates** ($15/M input, $75/M output, cache reads ~$1.50/M):

| Scenario | Estimated cost |
|---|---|
| Full v1 + tests, **no caching** | ~$85–105 |
| Full v1 + tests, **with prompt caching** (Claude Code default) | **~$30–50** |
| **Spine only** (2 hrs, no full test suite) | **~$12–20** |

**The levers:**
- Output tokens are fixed by how much code must exist — can't compress.
- Input tokens balloon with turn count and re-reads. **Long debug loops on the daemon run up the bill** — every failed-restart-reread cycle re-sends context.
- **Cheapest path to the same v1**: one sustained build pass rather than review-and-redirect between every step → fewer turns, more cache hits. Tight per-phase oversight roughly doubles input replay.

---

## Unit Testing Strategy

Testing adds wall-clock because it means *more* build-loop iterations, not fewer. Recommended v1 coverage:

**Pure-logic units (cheap, high value — do these)**
- Re-ranker math (sourceWeight × typeBoost × freshnessDecay × hitCountBoost)
- Injection-floor filter (keep/drop, no-inject outcome)
- Chunker boundaries (header-split, overlap, token fallback)
- Dedup threshold logic
- Content-hash staleness detection
- Injection formatter (breadcrumb dedup, multi-chunk same-file)

Deterministic, no daemon needed, fast to run. ~30–40 tests.

**Integration (expensive — fewer, targeted)**
- embed → store → query round-trip against real LanceDB
- daemon `/query`, `/health`, `/notify`
- hook stdin/stdout contract

Need fixtures + warm model, so each run is slow.

**Do NOT unit-test in v1**
- Haiku eval worker → mock the model call, test the *parser* only
- Cross-platform spawn edge cases → assert behavior, don't chase OS quirks

---

## Recommended Phased Approach

Ordered to get something real working fastest, then harden. Each phase ends with a concrete, verifiable outcome.

### Phase 0 — Demolition & Foundation (~30 min)
- Delete/replace ChromaDB client; create `scripts/` directory.
- Lock embedding config to Transformers.js + nomic default (config-driven, not hardcoded).
- Confirm `@lancedb/lancedb` API surface matches doc assumptions (this is where DESIGN.md may be wrong).
- **Exit criteria**: `lib/lance-client.ts` connects, creates a table, round-trips one record.

### Phase 1 — Embedding Pipeline (~45 min)
- `lib/embedder.ts`: Transformers.js nomic, mean pooling + normalize, model warm-load.
- `scripts/embed-contexts.js`: scan sources, whole-doc embed (defer chunking), store model + dimensions in metadata.
- **Parse + persist frontmatter** `metadata.type` and `tags` per chunk (the category/tag schema). `type` will feed the re-ranker; `tags` are stored-but-unused until v2 CAE. Reject files whose prefix and `metadata.type` disagree (cheap corpus hygiene).
- **Exit criteria**: `npm run embed` populates LanceDB from real `.claude/context/`; rows carry `type` + `tags`; `vector-inspector` can open it.

### Phase 2 — The Spine: Daemon + Query Hook (~1–1.5 hr) ← **first "wow" moment**
- `daemon/server.js`: `/health` (with `modelLoaded`), `/query`, `/notify`. Model loaded once.
- `scripts/session-start-hook.js` + `ensureDaemonRunning()` shared util (poll `/health`, don't sleep).
- `scripts/query-hook.js`: thin HTTP client, graceful degradation on daemon-down.
- Re-ranker (`typeBoost` reads `metadata.type`) + injection floor + injection format block.
- **Log rejection signals**: every chunk dropped by the floor is logged with its score (groundwork for v2 removal/governance — cheap now, can't backfill).
- **Exit criteria**: real prompt in a live session injects relevant context. *This is the demo.*

### Phase 3 — Capture & Incremental Updates (~45 min)
- `scripts/awareness-hook.js`: proposal footer, novelty signal derived from injected set.
- `scripts/watch-contexts.js`: PostToolUse → `/notify` → incremental re-embed.
- Hit-count tracking on retrieval.
- **Exit criteria**: editing a context file re-embeds without full rebuild; proposals appear in footers.

### Phase 4 — Pure-Logic Unit Tests (~1 hr)
- Cover re-ranker, floor, chunker, staleness, formatter, dedup.
- Wire `npm test`.
- **Exit criteria**: green suite on deterministic logic; fast (<5s, no model load).

### Phase 5 — Quality Measurement (~1 hr)
- Stop hook + eval worker wiring (Haiku calibration, parser-tested).
- Floor calibration harness: replay historical prompts, log similarity distribution.
- `/introspect` endpoint (Self-doc Layer 1, minimal): returns version, model + dimensions, loaded packs, chunk counts, floor, re-rank weights, hit-count stats, uptime. Feeds `/context-status`. **Defer** `generate-docs` and the 7 auto-doc files to v2.
- **Exit criteria**: a calibration run produces a floor recommendation from real data; `/context-status` reads live numbers from `/introspect`.

### Phase 6 — Hardening + First-Run Onboarding (~1.5 hr)
- Crash recovery, stale-PID cleanup, integration tests for daemon + hooks.
- Model/dimension validation fail-fast paths.
- **First-run onboarding** (see "First-Run Onboarding" section below): background auto-reconcile of a cold/stale corpus + a `/contextus-setup` skill.
- **Exit criteria**: kill the daemon mid-session → next prompt recovers gracefully; a fresh project with populated `.claude/context/` but no table auto-embeds in the background; `/contextus-setup` is idempotent.

**Phases 0–2 are the minimum viable spine (~2–2.5 hr).** Stop there for a working demo; Phases 3–6 are hardening and quality.

---

## How to Run the Build (Execution Cadence)

**Principle: the stop boundary is not the phase number — it's where verification needs a human or a live environment.** Stop where I can't self-verify; batch where the exit criterion is deterministic and I can check it myself. Tighter boundaries are also a guardrail against my own optimistic "done!" narration (see SELF_DOCUMENTATION.md §4.5) — catch a broken spine at Phase 2, not underneath Phase 4.

| Prompt | Phases | Stop reason |
|---|---|---|
| 1 | **0** | **Highest-risk unknown.** Does `@lancedb/lancedb` actually match the doc's API assumptions? If not, every later phase shifts. Cheap stop, huge information gain. |
| 2 | **1** | **Corpus exists now.** First moment §4.5 "verify before embedding" bites — you glance that the context files I authored are *true*, not just plausible, before they harden into the injected corpus. |
| 3 | **2** | **The spine / the demo.** "Real prompt injects real context in a live session" — *you* drive a live Claude Code session to verify. I cannot. Mandatory return. |
| 4 | **3 + 4** | Capture + incremental + pure-logic unit tests, **plus the `/migrate-memory` skill** (pipeline now exists to embed into). Deterministic, no live session; a green suite self-verifies. Safe to batch. |
| 5 | **5** | Calibration produces a floor recommendation from *your* historical prompts. Needs your data and your eyes on whether the number's sane. |
| 6 | **6** | Hardening → done. |

**Six prompts, four genuine decision points** (1, 2, 3, 5). Batching rules:

- **0→1 batch only if Phase 0's API check passes.** If LanceDB diverges from the doc, stop and re-plan before embedding anything. They're both "embedding pipeline" and mechanical, so combining is fine *given a green API check*.
- **3+4 always batch.** Tests are the verification; no reason to interrupt between writing capture logic and proving it.
- **Never batch across Phase 2.** The daemon spawn/detach/poll loop is the fiddly part; building capture or tests on top of a subtly-broken spine cross-contaminates debugging and burns tokens re-sending context.

**Token note:** returning at these seams lets you `/clear` or compact between prompts — that's where the real cost savings live, far more than terse output. A long unbroken run re-sends accumulated context every turn.

**At each stop I will:** state the exit criterion, what I verified vs. what needs *you* to verify, and any divergence from DESIGN.md. I won't claim a phase is done on something I haven't actually run.

---

## v2 Backlog (shaped by the new designs)

> **Canonical v2 list now lives in [V2_ROADMAP.md](V2_ROADMAP.md)** — it consolidates this table, the live open questions, and the Phase-6 additions (chunking maturity, multi-source incremental, deletion detection, the floor→CAE supersession, and the "no auto-floor" decision). The snapshot below is kept for historical context; update V2_ROADMAP, not this.

Deferred deliberately — none of these block a trustworthy v1, but the new docs gave them concrete shape. Listed roughly by dependency order.

| Item | Source design | Depends on |
|---|---|---|
| **CAE gate** — Haiku applicability sub-agent per candidate, scoring rubric (§4), hard overrides, conflict priority. Slots in as `… → floor → CAE → inject`. | CAE spec | v1 floor + rejection logging |
| **Tag-driven gating** — tags become live constraint modifiers once CAE consumes them (`tag_alignment`, deprecated/canonical overrides). | CAE §3, Categories §8 | CAE gate |
| **Hard-override authorship** — define *who/how* `deprecated`, `canonical`, `manually-promoted` get written. (Open question — no mechanism yet.) | CAE §4.3 | CAE gate |
| **Per-category retrieval config** — Category Rule 4: each category declares injection trigger, weight, scope, merge/compete behavior. Re-ranker reads it. | Categories §3 (Rule 4) | re-ranker |
| **Removal / governance** — soft (CAE demotion) / hard (deletion) / replacement (supersession), driven by accumulated rejection evidence. | CAE §7 | rejection logging (v1) |
| **Full Layer-1 auto-docs** — `generate-docs` + `docs/generated/*.md`, overwritten each run. **Requires** namespacing under `docs/generated/` so it never clobbers hand-written `DESIGN.md` et al. | Self-doc §2.2 | `/introspect` (v1) |
| **Model self-doc (Layer 2)** — 5-field phase-boundary entries → `docs/SELF_DOCUMENTING_IMPLEMENTATION.md`. (Process convention, can start anytime.) | Self-doc §3 | — |

---

## Memory → Context Migration (`/migrate-memory` skill)

Not a v2 design item — a **v1-era cleanup that must wait for the pipeline.** The canonical store is moving from `.claude/memory/` (named-slug files + `MEMORY.md` index) to `.claude/context/` (prefix-scoped, `metadata.type` + tags). The existing plumbing still points at `memory/`.

**Scope is small because it's config-driven, not hardcoded:**

| Touchpoint | Change |
|---|---|
| `plugin.json` → `config.sources.projectMemory.path` (`.claude/memory`) | repoint to `.claude/context` (or add a `context` source) |
| `plugin.json` → `config.sources.userMemory.path` (`~/.claude/memory`) | same |
| Content files | `decision_foo.md` (slug `foo`) → `decision-foo.md`; add `tags`, prefix-matched `type` |
| `MEMORY.md` index | folds into the corpus / `arch-overview` |

No `memory/` strings are hardcoded in hook JS, so this is **content conversion + a config flip**, not a code rewrite.

**The skill** (`/migrate-memory`) owns the conversion because the slug→prefix rename, `type` inference, and tag seeding recur and are easy to do inconsistently by hand:
- **Dry-run by default** — proposes each `slug → prefix-name` + inferred `type` + seed `tags`, shows the diff, converts on confirm.
- **Idempotent** — re-running skips already-migrated files; safe to resume if interrupted (no half-converted corpus).
- **Verify-before-embed** baked in (it's moving truth into the *injected* corpus — see SELF_DOCUMENTATION.md §4.5).

**Sequencing**: build the spine first (Phases 0–2) — there's no `embed-contexts` to land converted files into until then. The skill is built in **Prompt 4 (Phase 3)** and run once the pipeline is proven. Migrating earlier just creates orphaned files.

**Adjacent `plugin.json` staleness** (fix during Phase 0, not part of migration): `config.chroma` → `lancedb`; `embedding.model` is `Xenova/all-MiniLM-L6-v2` but DESIGN.md default is nomic; `similarityThreshold: 0.7` is the unvalidated floor.

---

## First-Run Onboarding (Phase 6)

**The gap (caught 2026-06-14):** session-start ensures the daemon is *running* but never checks whether the project's *corpus exists*. A fresh install with a populated `.claude/context/` but no LanceDB table hits `tableExists=false` in `/query` → injects nothing → silently, forever, until someone runs `pnpm run embed` by hand. For a system whose whole pitch is "context finds you," a cold project that quietly finds nothing is the trust-eroding failure mode — and it's invisible, so nobody reports it. Neither existing skill closes it: `configure` tunes paths but never embeds; `rebuild-embeddings` is a manual "something's broken" tool, not onboarding.

**Two halves, deliberately split by risk:**

### 1. Auto-reconcile — the silent safety net (automatic, in a hook)
- Session-start detects a **cold or stale** corpus: context files exist on disk but the LanceDB table is missing, or its row count / content hashes lag the files.
- Fires a **background** reconcile via the daemon — a new `/reconcile` endpoint, or just per-file `/notify` (the Phase-3 staleness skip already makes a reconcile cheap and idempotent: unchanged files cost nothing).
- **Background, not blocking** — embedding N files + a model load can't fit the 20s session-start window; the first prompt or two may miss context while it warms, which is the existing graceful-degradation behavior.
- Reports via `systemMessage` per `notifications.verbosity` (user-facing, never `additionalContext`).
- **One-time nudge:** if no contextus stanza is found in the project CLAUDE.md, the systemMessage suggests running `/contextus-setup`. (Decision 2026-06-14: embed + nudge, not embed-only — discoverability.)
- **Never touches CLAUDE.md.**

### 2. `/contextus-setup` — the explicit half (a skill, user-invoked)
- Scaffold `.claude/context/` + a starter `CONTEXT.md` index if absent.
- Drop a small contextus stanza into the project CLAUDE.md inside a **marked, idempotent** block (`<!-- contextus:start --> … <!-- contextus:end -->`) so re-running updates-in-place instead of duplicating. The stanza tells a fresh Claude instance that context is injected here and patterns can be proposed via the footer — making the Phase-3 awareness loop legible rather than mysterious.
- Run the initial embed; confirm the daemon; print status.
- **This is the ONLY thing that edits CLAUDE.md.**

**Firm constraint:** a hook must never auto-edit CLAUDE.md — it's an outward-facing file the user owns; silently rewriting it every session is invasive. The cheap, invisible embed reconcile may be automatic; the visible file edit is opt-in, behind a marked block. (Decision 2026-06-14: build in Phase 6, not as a standalone phase — it's out-of-box/hardening work.)

### Open questions still live
- **CAE cost model**: Haiku-per-candidate on every injected prompt — acceptable, or batch candidates into one call? (CAE §12 lists batching as a future layer.)
- **Floor vs CAE authority**: once both exist, CAE §4.4 ranks similarity *last*. Confirm the floor still short-circuits cheaply before any CAE call (don't pay for an LLM verdict on a chunk the floor already killed).
- **Hard-override provenance**: nothing currently writes `canonical`/`deprecated`/`manually-promoted`. Needs an authoring path before those overrides do anything.
- **Auto-doc namespace**: lock `docs/generated/` (or similar) before building `generate-docs` so the "never hand-written" rule can't overwrite the hand-written specs.

---

## Bottom Line

- **Feasible**: yes, low risk. The thinking is done; this is execution.
- **Engineer-days**: ~2 days to demo, ~7–8 days to trustworthy v1.
- **AI wall-clock**: ~2 hrs to spine, ~5–7 hrs to full v1 with tests.
- **AI token cost**: ~$12–20 spine, ~$30–50 full v1 with caching.
- **Recommended start**: Phases 0–2 in one sustained pass → one real injection working → then layer tests and quality.
- **The new designs don't move these numbers.** CAE, full auto-docs, and removal mechanics are v2; v1 only gains lightweight touches (frontmatter schema in Phase 1, rejection logging in Phase 2, `/introspect` in Phase 5) already folded into the estimates above. The estimate holds.
