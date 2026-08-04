---
name: claude-code-hook-surface-limitations
description: Two architectural workarounds contextus needs specifically because Claude Code's hook surface doesn't expose these directly: context-window usage, and mid-task injection
metadata:
  type: tradeoff
  tags: ["claude-code", "hooks", "architecture", "limitation", "statusline", "injection"]
---

# Claude Code Hook Surface Limitations (why two contextus workarounds exist)

Two real friction points surfaced discussing whether an open-source coding-agent harness (oh-my-cli, built by Qwen3.8-Max as an autonomous-coding demo) would sidestep problems contextus has had to work around in Claude Code. Both are genuine, not hypothetical -- they shaped real architecture decisions already shipped.

## 1. No first-class context-window/token-usage API

Claude Code never hands a hook (UserPromptSubmit, PostToolUse, etc.) the current conversation's token usage directly. The ONLY place that data appears at all is the **statusline** render payload (`context_window.{total_input_tokens, total_output_tokens, used_percentage}`), and only AFTER a turn completes.

This forced a genuinely awkward three-hop relay just to let the daemon make an injection-size decision (see `implementation-token-overflow-protection-architecture.md`):

```
Statusline (renders after each turn)
  -> writes ~/.contextus/runtime/<session>.context-stats.json
    -> query-hook.js reads the file, includes contextStats in the /query POST
      -> daemon checks used_percentage before embedding/injection
```

If Claude Code exposed `context_window` directly on the UserPromptSubmit hook payload, this whole file-relay indirection -- plus the installer script that has to patch a user's `statusline-command.sh` at all -- would not need to exist. It's a workaround for a missing field, not a chosen design.

**Known staleness cost of this indirection**: stats reflect end-of-*previous*-turn, not the current prompt's real-time size -- a deliberate conservative bias (see the implementation doc's "1-turn staleness is conservative" design note), but still a real accuracy gap that a direct API wouldn't have.

## 2. Injection fires once per human turn, not per agentic step

Contextus's only trigger for retrieval is `UserPromptSubmit` -- which fires exactly once per message the HUMAN submits. It does NOT fire again during a long autonomous tool-use loop within that same turn (the model calling many tools across many internal steps without new human input).

Consequence: if Claude pivots to a materially different subtask several tool-calls into a single turn, contextus has no hook to catch that pivot and inject fresh context for it -- whatever was injected at the START of the turn (based on the ORIGINAL prompt) is all contextus ever gets to contribute to that turn, no matter how long or how many different subtasks the turn's internal tool-use loop covers.

This is an accepted architectural ceiling, not a bug to fix by working harder within the existing hook -- there is currently no Claude Code hook that fires mid-turn, between tool calls, that a plugin could use to re-trigger retrieval. Worth revisiting if Claude Code ever exposes a per-tool-call or per-step hook.

## Why this isn't an argument for switching harnesses

An open-source harness (like oh-my-cli) would make BOTH of these inspectable/patchable at the source level instead of reverse-engineered via live experiments -- but oh-my-cli specifically is ~3 weeks old (created 2026-07-13), 337 stars, built largely as an autonomous-coding capability demo rather than a mature product, with no equivalent skills/plugin-marketplace/statusline ecosystem yet for something like contextus to attach to. The tradeoff (source-inspectable but immature vs closed but mature) doesn't currently favor switching -- these two limitations are documented as known constraints to design around, not reasons to abandon the platform.

## Related

- `implementation/implementation-token-overflow-protection-architecture.md` -- the statusline-bridge implementation itself
- `decisions/decision-...` (none yet for #2 -- this file is the first place the multi-step-injection ceiling is documented)
- The stale gotcha this superseded (`gotcha-long-conversation-token-overflow.md`, describing the token-overflow problem as unfixed when it had already been fixed) was archived to `.archive/` in the same pass this file was captured -- discovered by cross-referencing against the implementation doc while writing this note.
