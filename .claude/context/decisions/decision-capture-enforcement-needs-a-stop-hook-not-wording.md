---
name: capture-enforcement-needs-a-stop-hook-not-wording
description: Wording tweaks to the capture obligation are low-leverage; the fix is a Stop hook that gates turn completion, not a stronger prompt
metadata:
  type: decision
  tags: ["capture-discipline", "hooks", "enforcement"]
---

# Decision: capture enforcement needs a Stop hook, not stronger wording

## Context
See [[gotcha-trigger-capture-on-the-verbalized-insight-not-at-wrapup]]. Even with an already-maximally-directive instruction ("OBLIGATION: you MUST capture..."), captures were repeatedly skipped across a whole session on a long fix→chase→revert→re-verify task. The user asked: should the wording in contextus change?

## Analysis
Wording is not the bottleneck. The failure is structural: the capture reminder fires via UserPromptSubmit, competing with the live task, and nothing blocks the turn from ending without a capture call.

## Decision — three changes, in order of leverage
1. Move the check to a Stop hook, not UserPromptSubmit.
2. Make it a hard gate for cheaply-detectable cases (git commit + no capture logged since).
3. Track the miss rate as a metric, the way retrieval usage is already tracked.

## Status: fully prototyped (2026-09-11)
All three items implemented on branch `feat/capture-stop-hook-gate`:

- **Items 1+2** (commit 19d2d5b): `scripts/lib/capture-gate.js` (pure detection logic) + `scripts/capture-gate-hook.js` (Stop-hook wrapper, off by default via `contextCapture.stopGate`, honors `stop_hook_active` loop guard).
- **Item 3 — miss-rate metric** (commit follows 9610e3d): the hook now logs on BOTH invocations — the initial block (`outcome: nudged`) and the retry after Claude's response to the nudge (`outcome: captured_after_nudge` or `outcome: missed`). `extractCommitSummary()` pulls a human-readable commit subject (handles `-m "..."`, `-m '...'`, and this repo's own heredoc commit convention). `logCaptureNudge()` writes a structured record to `~/.contextus/logs/capture-nudges.jsonl` (for aggregate miss-rate analysis later) AND a human-readable line to `~/.contextus/logs/daemon.log` — e.g. `Nudged Claude to capture context for "fix: x" but it did not` — so it surfaces in `contextus watch` immediately instead of only being discoverable by asking after the fact.
- Config: `contextCapture.stopGate` documented in both `plugin.jsonc` and the annotated `examples/contextus.jsonc`, plus a feature note in `docs/FEATURES.md`.
- Tests: `tests/capture-gate.test.ts` covers `extractCommitSummary` (all message-format cases) and `logCaptureNudge` (JSONL + human-log content, best-effort failure handling). Full suite (452 tests) + `tsc --noEmit` + prettier all green.

Not yet merged to main; needs real dogfooding with `stopGate: true` before considering it a default. Natural next step once dogfooded: a `/context-stats`-style rollup of `capture-nudges.jsonl` (nudge rate, miss rate over time) rather than raw log-tailing.

