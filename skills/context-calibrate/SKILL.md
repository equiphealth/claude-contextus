---
name: context-calibrate
description: Quality measurement and optimization — evaluate whether injected context is actually USED (--floor to tune injection threshold, --campaign for bounded sampling). Proves whether contextus is working.
---

# context-calibrate

**Quality measurement** — tune injection floor via cold-start replay or usage-eval campaigns.

## When to use

- **Cold-start** (`--floor`): First calibration after building a corpus (needs transcripts, zero usage history required)
- **Usage-eval** (`--campaign`): After 1-2 weeks of real usage to refine thresholds based on what's actually used
- **Check status**: `--status` to see running campaigns, `--report` for results

## Two signals

1. **Floor-replay** — replays historical prompts, recommends injection threshold from similarity distribution (works immediately)
2. **Usage-eval** — Haiku grading campaign over real injections, refines thresholds from actual usage (needs accumulated data)

Clean lifecycle: floor-replay → initial floor → usage accumulates → usage-eval refines.

## Instructions

Run the calibration CLI from the target project directory (see implementation guide for exact commands).

Present results, suggest `--diff` to preview changes, then `--apply` to write to config.

See [./reference.md](./reference.md) for:
- How to invoke `calibrate-floor.ts` (tsx by path, NOT pnpm)
- Floor-replay flags (`--project`, `--limit`, `--json`)
- Usage-eval campaign lifecycle (`--start`, `--status`, `--report`, `--stop`)
- Result interpretation and threshold tuning
- Common pitfalls (project name vs hash, Node version issues)
