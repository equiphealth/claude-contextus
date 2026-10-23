---
name: staggered-decaying-reinjection
description: >-
  Design sketch for decaying the per-turn capture-mode footer across a session
  instead of repeating it in full every UserPromptSubmit
metadata:
  type: tradeoff
  tags:
    - capture
    - hooks
    - token-efficiency
    - session-state
---

# Staggered/decaying reinjection for capture-mode instructions

Currently the awareness-hook (and similar always-on UserPromptSubmit footers) re-inject the full capture-mode block on every single prompt. For a long session that is the ~565-token block times N turns, with no decay.

## Problem
Full reinjection every turn is token-expensive, but a one-shot reminder (inject once, then never again) is known to fail -- this is exactly the failure mode observed with codebase-memory-mcp: the reminder fades from the model's attention and compliance drops over a long session. See [[tradeoff-claude-code-hook-surface-limitations]] for the related ceiling that UserPromptSubmit only fires once per human turn, not per internal tool-use step -- any staggering scheme has to live within that same one-fire-per-turn constraint.

## Proposed design
1. **Per-session counter**: each hook invocation is a fresh process (no in-memory state survives between calls), so persist a small counter keyed by `session_id` -- either a tiny state file (e.g. `~/.contextus/session-state/<session_id>.json`) or a row in the daemon's existing DB/service, since the daemon is already running and that avoids scattering loose files.
2. **Decay schedule instead of hard on/off**:
   - Turn 1: full block (teaches the pattern in full)
   - Turns 2-N: a ~15-token one-line ping, e.g. `[contextus] capture mode active -- see earlier instructions`
   - Every Kth turn (e.g. every 10): re-inject the full block, so a long session doesn't drift back to forgetting it entirely
3. **Reset on SessionStart**: a new session (or `/clear` / `/compact`) zeroes the counter. `session-start-hook.js` already exists and could own this reset.

Net effect: ~565 tokens once + ~15*9 for a 10-turn window + periodic refresh, instead of 565*10 flat -- a large reduction over long sessions while keeping the periodic refresh that's believed to be *why* this approach would outperform codebase-memory-mcp's one-shot reminder.

## Open question / caveat
This is a hypothesis, not yet validated. Compliance rate (does `/capture` still get called at the same rate under the decayed schedule?) needs to be measured with `context-calibrate` once that measurement path exists, rather than assumed from vibes -- consistent with the project's existing principle of "quality over vanity metrics," and the recurring theme that reminder-fade assumptions should be checked with real usage data, not assumed.

## Fit
Likely implemented as a tweak to `scripts/awareness-hook.js` plus a tiny new session-state helper (reuse `lib/session-state.ts` if it already models per-session data, else add alongside it). Worth filing as a GitHub issue before building.

