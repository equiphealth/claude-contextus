---
name: stop-hook-retry-cant-reuse-block-decision-logic-for-outcome
description: >-
  On a Stop hook's stop_hook_active retry, don't reuse the same block-decision
  function to determine whether the issue resolved - its preconditions (like
  hasGitCommit) are scoped to the retry's own boundary-shifted transcript view
  and will be falsely unsatisfied, misreporting every retry as unresolved
metadata:
  type: gotcha
  tags:
    - hooks
    - stop-hook
    - transcript
    - capture-gate
---

## Symptom

Fixing `extractLastTurn` to stop mistaking a `tool_result` for the real turn boundary (see `gotcha-transcript-tool-result-is-also-type-user.md`) wasn't enough to make the Stop-hook capture-enforcement gate's miss-rate metric work. On the `stop_hook_active` retry invocation, the logged outcome was ALWAYS `missed`, even in a test where the retry's response text clearly contained a `Context: captured:` footer proving the nudge worked.

## Root cause

The retry handler reused `shouldBlockForCapture({ toolUses, responseText, turnStartTs, lastCaptureTs })` - the SAME function used to decide whether to block in the first place - to also decide the outcome on retry. But `shouldBlockForCapture`'s first line is `if (!hasGitCommit(toolUses)) return false;`. On the retry invocation, `toolUses` is extracted fresh from the transcript, scoped to "everything after the most recent genuine user-shaped entry" - which, after a block, is the hook's OWN injected block-reason text (itself written back into the transcript as a new turn-boundary-shaped entry). So `toolUses` on the retry never contains the original `git commit` call - `hasGitCommit` is unconditionally false, and `shouldBlockForCapture` returns `false` (meaning "not missing") regardless of what actually happened, for the WRONG reason (no commit in view) rather than the right one (a capture happened).

This is subtle because `shouldBlockForCapture` returning `false` happened to look plausible either way - "stillMissing is false" reads as "it's resolved," which is sometimes right and sometimes an accident.

## Fix

Don't reuse a block-decision function (whose preconditions assume you're deciding whether to block from scratch) to answer a different question ("did this ALREADY-KNOWN issue get resolved since we blocked"). On retry, we already know a commit happened - that's why a pending marker exists - so check resolution directly: an explicit skip acknowledgment, a captured footer, or a `captures.log` entry timestamped at/after the ORIGINAL turn's start (persisted in the marker written when we blocked, not re-derived from the retry's own boundary-shifted transcript view).

## How to apply

Whenever a hook (or any stateful check) has two phases - "decide whether to act" and "decide whether the action's goal was met" - don't assume the SAME extracted inputs are valid for both phases just because they're computed by the same `extractX(transcript)` call. The second phase often needs context carried forward from the first (via a marker file, a cache, whatever), not re-derived fresh from a transcript whose shape has since changed because of the first phase's own side effect (e.g. the block message itself altering what "the current turn" looks like).

## Related

Same root transcript-shape issue as `gotcha-transcript-tool-result-is-also-type-user.md`, one layer up: discovered while implementing fixes from a self-review of PR #88 (claude-contextus, the Stop-hook capture-enforcement gate prototype) - specifically the finding that the miss-rate metric never logged on retry.
