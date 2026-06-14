---
name: calibration-two-signals
description: Two independent floor-calibration signals (similarity-replay vs Haiku usage-eval) — keep distinct, wire both into /context-calibrate in Phase 6, floor-replay sets cold-start then usage-eval refines
metadata:
  type: decision
  tags: [calibration, floor, retrieval, phase-5, phase-6]
---

**Decision (2026-06-14)**: contextus has **two distinct floor-calibration signals**. Keep them conceptually separate but expose both through the one `/context-calibrate` skill (one apply path). Wire the floor-replay path in during **Phase 6**, not Phase 5.

**The two signals:**

| | floor-replay (`pnpm calibrate-floor`, Phase 5) | usage-eval (`/context-calibrate --start/--report`) |
|---|---|---|
| Signal | similarity distribution over replayed historical prompts | did Claude actually *use* the injected pattern (Haiku grades critical/helpful/mentioned/unused) |
| Needs | a corpus + transcripts — **works cold, no usage yet** | a live 100-prompt campaign — needs accumulated usage |
| Cost | free, instant, no LLM | Haiku calls over days/weeks of real use |
| Applies config? | **no — prints only** (built to be eyeballed first) | yes (`--apply`/`--diff`) |

**Why both, not one**: they answer different questions. floor-replay = "where does the similarity distribution naturally split signal from noise?" (the cold-start floor when there's no usage history). usage-eval = "given real usage, is the floor letting noise through / suppressing useful patterns?" (the refinement). The clean lifecycle: **floor-replay sets the cold-start floor → usage-eval refines it once real usage accumulates.**

**Why wire the front door in Phase 6, not Phase 5**: the Phase-5 floor-replay recommendation (0.49) is **corpus-bound** — it ran on a 3-file corpus where most replayed prompts are noise. The number isn't trustworthy until `/migrate-memory` populates the corpus (a Phase-6 step). Building an `--apply` on top of an untrustworthy recommendation just makes it faster to write a bad value. So: `/migrate-memory` populates → re-run replay → *now* the recommendation is actionable → and that's the same moment the `--apply` wiring earns its keep. Build the wire-up and get the first real number to apply in the same phase, on the same data.

**Shape of the Phase-6 wire-up**: add a `--floor` mode to `/context-calibrate` (`--floor`, `--floor --diff`, `--floor --apply`) that runs the replay harness (`scripts/calibrate-floor.ts` / `lib/floor-calibration.ts`) and reuses the existing usage-path `--diff`/`--apply` plumbing to write `config.retrieval.injectionFloor`. The standalone `pnpm calibrate-floor` CLI **stays** as the engine + dev/debug entry point.

**Note**: this absolute-floor work is itself superseded long-term by the **v2 top-K + relative-separation gate** (CAE), which discriminates better than any single absolute threshold — see [[floor-calibration-signals]]. The two-signal apply path is the v1 honest answer until then.

**Related**: [[evaluation-architecture]], [[floor-calibration-signals]], [[memory-to-context-migration]], [[ollama-model-quality]]
