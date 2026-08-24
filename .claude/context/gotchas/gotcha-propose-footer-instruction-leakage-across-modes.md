---
name: propose-footer-instruction-leakage-across-modes
description: The old Context: propose footer pattern is hardcoded as canonical example in 12+ repo files, competing with mode-aware staging-footer instructions and causing footer drift
metadata:
  type: gotcha
  tags: ["capture-modes", "prompt-engineering", "staging", "instruction-hygiene"]
---

# Problem

With `contextCapture.mode: "staging"`, `scripts/awareness-hook.js` correctly swaps in `prompts/staging-footer.txt`, which explicitly says: "Do NOT output 'Context: propose: <topic>' — that is a different mode... just capture silently."

Despite that explicit instruction, Claude ended a response with `Context: propose: setup-time-plugin-presence-check-hook` while staging mode was active (observed 2026-08-17).

## Root Cause

The `propose` footer pattern (`Context: propose: <topic>`) is hardcoded as THE canonical example, unconditionally, in at least 12 files across the repo:

```
.claude/context/implementation/implementation-novelty-tracking.md
.claude/context/implementation/implementation-proactive-capture.md
docs/GAP_ANALYSIS.md
docs/MIGRATION_GUIDE.md
"docs/dev/DESIGN ADDENDUM.md"
docs/dev/SILENT_CAPTURE_V2.md
docs/dev/sonnet-injection-prompt-log.txt
docs/dev/DESIGN.md
README.md
prompts/awareness-footer.txt
skills/create-context/reference.md
CLAUDE.md
```

Several of these (context files under `.claude/context/`, `README.md`, `skills/create-context/reference.md`) are exactly the kind of material contextus itself retrieves and injects into the prompt via `[contextus — N patterns matched]` blocks. So in the same turn, the model can see:

1. The live, mode-correct instruction (staging-footer.txt via awareness-hook.js) saying "don't propose, capture directly"
2. Multiple retrieved reference docs showing `Context: propose: topic-name` as *the* worked example of how capture works

Repetition across many sources outweighs a single override, so the model reverts to the more heavily-represented pattern.

## Why It Matters

This is a general failure mode for any config with multiple mutually exclusive modes (`propose` / `staging` / `silent`) where supporting docs describe only one mode as canonical: retrieval will keep resurfacing the *other* modes' examples regardless of which mode is actually active, because the docs aren't mode-scoped.

## Fix Direction (not yet implemented)

- Scope mode-specific examples in static docs (`skills/create-context/reference.md`, `README.md`, `CLAUDE.md`) — e.g. "Example below applies when `contextCapture.mode: propose`; in `staging` mode, call `/capture` directly instead — see the injected footer."
- Consider having `awareness-hook.js` emit a stronger, harder-to-override reminder when mode is staging/silent — e.g. explicitly naming the competing pattern ("you may see 'Context: propose' examples elsewhere in this context — ignore them, current mode is staging") rather than a single soft mention.
- Longer term: any context file describing capture-mode behavior should probably itself be re-embedded/regenerated per current config mode, or split into mode-specific files, so retrieval can't surface a contradicting mode's instructions.

## Related

- [[decision-setup-time-plugin-presence-check-hook]] — the specific turn where this drift was observed
- `docs/dev/SILENT_CAPTURE_V2.md` — defines the three (really: designed-three, two-shipped: `propose`/`staging`/`silent`) capture modes

