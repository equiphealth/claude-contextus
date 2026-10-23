---
name: false-positive-fix-can-trade-for-worse-false-negative
description: >-
  Tightening a heuristic regex to kill a false positive can silently introduce a
  false negative that is worse than the original problem, especially when
  real-world usage routinely wraps the thing being matched
metadata:
  type: gotcha
  tags:
    - regex
    - heuristics
    - code-review
    - stop-hook
---

## What happened

A self-review flagged that `GIT_COMMIT_RE` (`scripts/lib/capture-gate.js`) over-matched: `/\bgit\b[^\n]*\bcommit\b/i` matched `grep -rn "git commit" CONTRIBUTING.md` and `git log --grep=commit`, neither of which runs a commit. The fix anchored the match to the start of a command segment: `/(?:^|[;&|\n])\s*git\s+(?:-\S+\s+)*commit\b/i` - requiring "git" to be the first token after a separator or string start.

This passed tests and looked correct. The user caught the real problem: this environment (and probably most real ones) routinely wraps git invocations - a shell alias, a PreToolUse hook that rewrites the command, or just typing `rtk git commit -m "x"` directly (this repo's own `~/.claude/settings.json` permission allowlist literally has `Bash(rtk git *)`). In every one of those cases, "git" is NOT the first token of its command segment - the anchored regex would never match, and the Stop-hook gate would silently stop firing for the exact case it exists to catch.

## Why this is a worse failure than the original bug

The original over-matching cost "one extra Stop-hook round trip" per the module's own design comment - cheap, visible, self-correcting (you'd notice a weird false block). The anchored fix's false negative costs *silence* - the gate just never fires, with no error, no log line, nothing to notice. For a feature whose entire purpose is "don't let an uncaptured commit slip through unnoticed," a silent false negative defeats the feature more completely than the bug it was fixing.

## The actual fix

Don't anchor on what precedes the match (too fragile against real-world wrapping). Instead, exclude ONLY the concrete false positives actually found, by inspecting the match itself:
- `(?<!=)\bcommit\b` - excludes "commit" as a flag value (`--grep=commit`) without caring what's before "git" at all.
- A quote-count check on the text before the match (odd number of unclosed quotes = we're inside a string literal, e.g. a grep pattern) - also independent of prefix.

Both exclusions are scoped to the specific false positive, not a blanket positional requirement that happens to also exclude every legitimate variant you didn't think to test.

## How to apply

When tightening ANY heuristic regex/matcher in response to a found false positive: before shipping, explicitly enumerate how the matched thing is REALLY invoked in this environment (aliases, wrappers, hooks that rewrite input, common prefixes) and write a regression test for at least one of them. A fix that only has tests for "detects the bug case" and "doesn't match the known-bad case" can still silently break every real invocation style nobody thought to add a test for - the gap is invisible until a human who knows the actual usage patterns looks at the diff and asks "would this still work with X?"
