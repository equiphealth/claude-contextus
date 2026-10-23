---
name: transcript-tool-result-is-also-type-user
description: >-
  Claude Code transcripts record tool_result entries with type user, same as
  real human prompts - scanning backward for type===user to find a turn boundary
  stops at the wrong place
metadata:
  type: gotcha
  tags:
    - hooks
    - transcript
    - stop-hook
    - capture-gate
---

## Symptom

A Stop-hook capture-enforcement gate (`scripts/capture-gate-hook.js` / `scripts/lib/capture-gate.js`) that scans a Claude Code transcript JSONL file backward looking for `type === 'user'` to find "where this turn started" silently found the wrong boundary on every realistic multi-step turn. It worked in hand-written test fixtures (one user message, then straight to the final assistant text) but did nothing live, even when a `git commit` ran with no capture logged.

## Root cause

Claude Code's transcript format mirrors the Anthropic Messages API: every `tool_use` block is followed by its `tool_result`, and **tool_result entries are themselves stored as `type: 'user'` transcript entries** (same shape a real human-authored prompt uses). Confirmed directly against a live transcript:

```
user | ['tool_result']
```

So a backward scan for `entry.type === 'user'` stops at the tool_result immediately following the LAST tool call of the turn - not the actual human prompt. Everything before that point (every earlier tool_use in the same turn, including a `git commit` that wasn't the final tool call) is silently discarded. Concretely: assistant(git commit) -> user(tool_result) -> assistant(git status) -> user(tool_result) -> assistant(final text) scans backward, hits the tool_result after `git status` first, and never sees the `git commit` call at all.

## Fix

Don't treat every `type: 'user'` entry as the turn boundary. Check whether its `message.content` is a genuine human message (a plain string, an empty array, or an array containing at least one block that ISN'T `type: 'tool_result'`) before accepting it as the boundary; otherwise skip past it and keep scanning backward. See `isGenuineUserTurnStart()` in `scripts/lib/capture-gate.js`.

## How to apply

Any code that parses a Claude Code (or more generally, Anthropic Messages API-shaped) transcript JSONL and needs to find "the start of the current turn" by looking for a `user`-role entry MUST distinguish a real user prompt from a tool_result wrapper - never assume `type === 'user'` alone means a human wrote it. This bug is easy to miss in unit tests because synthetic single-tool-call fixtures never exercise the tool_result-in-the-middle case; a regression test needs at least two tool_use/tool_result pairs before the final response to catch it.

## Related

Discovered live while dogfooding the Stop-hook capture-enforcement gate prototype (`decisions/decision-capture-enforcement-needs-a-stop-hook-not-wording.md`) on the claude-contextus repo itself - the gate appeared to silently do nothing across two separate test commits before this was traced to the actual root cause.
