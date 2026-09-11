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
- Nothing blocks the turn from ending without a capture call — there is no equivalent of this repo's own pre-commit hook, which does not *ask* the agent to run `npm run build`, it *runs it and fails the commit* if skipped. The capture nudge has no equivalent teeth.

## Decision — three changes, in order of leverage

1. **Move the check to a Stop hook, not UserPromptSubmit.** A Stop hook fires at the natural end of a turn, when there's no competing task left — the same checkpoint that already works for build/lint gates. Scope it to: did this turn touch files / run shell commands / surface a decision, with no matching `/capture` call in the transcript for that turn? If so, force a nudge or hold turn completion.
2. **Make it a hard gate for cheaply-detectable cases, not just a suggestion.** Doesn't need an LLM judgment call every time — a heuristic (e.g. "git commit made this turn + no /capture call this session") is enough to force a checkpoint. This is the same mechanism already floated in V2_ROADMAP Track B ("Stop hook for usage-data staleness") pointed at a different signal.
3. **Track the miss rate as a metric**, the way retrieval usage is already tracked: "retrieval-gap footers surfaced: N, captures made: M." This alone would have surfaced the miss mid-session instead of only when the user asked directly.

## Why not just reword
The failure mode isn't ambiguity in the instruction — it's that a competing live task always wins when nothing *enforces* the alternative. Soft reminders lose to task momentum regardless of how directively they're worded.

## Status
Proposed, not yet implemented. Candidate for a Stop-hook prototype in `hooks/` alongside the existing UserPromptSubmit capture-context hook. Relates to daemon capture pipeline in `daemon/server.ts` (`/capture` endpoint) and existing hook registration in `hooks/hooks.json`.

