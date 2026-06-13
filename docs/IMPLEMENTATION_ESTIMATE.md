# Implementation Estimate & Phased Approach

_Authored: 2026-06-13 by Claude (Opus 4.8)_

**Purpose**: Honest estimate of what it takes to build claude-contextus v1 end-to-end, plus a recommended phase-based build order. Two estimate lenses are given because they answer different questions:

1. **Engineer-days** — how long a human engineer would take.
2. **AI wall-clock + token cost** — how long *I* (Claude Code) would take if told "do it now," and what that costs.

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
- **Exit criteria**: `npm run embed` populates LanceDB from real `.claude/context/`; `vector-inspector` can open it.

### Phase 2 — The Spine: Daemon + Query Hook (~1–1.5 hr) ← **first "wow" moment**
- `daemon/server.js`: `/health` (with `modelLoaded`), `/query`, `/notify`. Model loaded once.
- `scripts/session-start-hook.js` + `ensureDaemonRunning()` shared util (poll `/health`, don't sleep).
- `scripts/query-hook.js`: thin HTTP client, graceful degradation on daemon-down.
- Re-ranker + injection floor + injection format block.
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
- **Exit criteria**: a calibration run produces a floor recommendation from real data.

### Phase 6 — Hardening (~1 hr)
- Crash recovery, stale-PID cleanup, integration tests for daemon + hooks.
- Model/dimension validation fail-fast paths.
- **Exit criteria**: kill the daemon mid-session → next prompt recovers gracefully.

**Phases 0–2 are the minimum viable spine (~2–2.5 hr).** Stop there for a working demo; Phases 3–6 are hardening and quality.

---

## Bottom Line

- **Feasible**: yes, low risk. The thinking is done; this is execution.
- **Engineer-days**: ~2 days to demo, ~7–8 days to trustworthy v1.
- **AI wall-clock**: ~2 hrs to spine, ~5–7 hrs to full v1 with tests.
- **AI token cost**: ~$12–20 spine, ~$30–50 full v1 with caching.
- **Recommended start**: Phases 0–2 in one sustained pass → one real injection working → then layer tests and quality.
