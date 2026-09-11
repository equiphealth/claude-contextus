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
Wording is not the bottleneck — the instruction is already about as strong as text gets. The failure is structural:

- The capture reminder is injected via **UserPromptSubmit**, which fires at the *start* of every turn, competing for attention against whatever the live task is. A live task always wins against a soft reminder.
- Nothing blocks the turn from ending without a capture call — there is no equivalent of this repo's own pre-commit hook, which does not *ask* the agent to run `npm run build`, it *runs it and fails the commit* if skipped. The capture nudge had no equivalent teeth.

## Decision — three changes, in order of leverage

1. **Move the check to a Stop hook, not UserPromptSubmit.** A Stop hook fires at the natural end of a turn, when there's no competing task left. Scope it to: did this turn touch files / run shell commands / surface a decision, with no matching `/capture` call for that turn? If so, force a nudge or hold turn completion.
2. **Make it a hard gate for cheaply-detectable cases, not just a suggestion.** A heuristic ("git commit made this turn + no capture logged since") is enough to force a checkpoint, no LLM judgment call needed.
3. **Track the miss rate as a metric**, the way retrieval usage is already tracked.

## Why not just reword
The failure mode isn't ambiguity in the instruction — it's that a competing live task always wins when nothing *enforces* the alternative.

## Status: prototyped (2026-09-11)
Implemented item 1 (Stop hook) + item 2 (hard gate, narrow heuristic) on branch `feat/capture-stop-hook-gate`, commit `19d2d5b`:

- `scripts/lib/capture-gate.js` — pure detection logic: `hasGitCommit`, `hasExplicitSkip` (`Context: capture-skip: <why>`), `hasCaptureFooter` (`Context: captured:`/`propose:`), `lastCaptureTimestamp` (reads `~/.contextus/captures.log`), `shouldBlockForCapture` (combines all of the above against the turn's start timestamp).
- `scripts/capture-gate-hook.js` — thin Stop-hook wrapper. Honors Claude Code's `stop_hook_active` field as a loop guard (nudges once per stop cycle, never traps the session). Gate is **off by default**, opt in via `config.contextCapture.stopGate: true` (plugin.jsonc / `.claude/contextus.jsonc`) — this is a prototype, not yet a default.
- Registered as a second entry under the existing `Stop` hook slot in `hooks/hooks.json`, alongside `stop-evaluation.js`.
- Tests: `tests/capture-gate.test.ts` (pure-logic unit tests) + two smoke-test cases added to `tests/hooks-smoke.test.ts` (gate-disabled-by-default no-op, and stop_hook_active loop guard). Full suite (443 tests) + `tsc --noEmit` + prettier all green.

Item 3 (miss-rate metric) not yet implemented — natural follow-up once the gate has been dogfooded and logs real block events.

Not yet merged to main; needs real dogfooding with `stopGate: true` before considering it a default.

