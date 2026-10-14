---
name: thinking-blocks-as-independent-usage-verification
description: "Visible thinking blocks were an independent cross-check on the self-reported 'Context: used:' footer calibration relies on -- losing them (if Sonnet 5's adaptive reasoning removes visible blocks) weakens usage-signal quality, not just debugging convenience"
metadata:
  type: tradeoff
  tags: ["calibration", "usage-signal", "thinking-blocks", "sonnet-5", "self-report-bias"]
---

# Thinking Blocks as Independent Verification of Contextus's Usage Signal

## The distinction that matters

During a tangent about Sonnet 5 possibly removing visible thinking blocks (unconfirmed -- surfaced via a Reddit thread describing a "leak," not an Anthropic changelog entry or model card note; could not independently verify against official docs), a real, contextus-specific consequence surfaced: visible thinking blocks and the debug statusline (`scripts/install-debug-statusline.sh`) give DIFFERENT signals, and losing the former is not fully compensated by the latter.

- **Debug statusline** = contextus's own telemetry. Tells you WHAT the pipeline did: injected count, which file, score vs floor. This is supply-side -- did contextus do its job of retrieving/injecting.
- **`Context: used: <file> (<score>)` footer** = the model's SELF-REPORT. Parsed by `scripts/stop-evaluation.js` (the Stop hook) as the primary usage signal for calibration (`usage_signal` events, `usage.jsonl`, feeds the calibration-eval pipeline). The model is explicitly instructed (via the awareness/capture-mode footer) to append this -- it is not independently observed, it's compliance with an instruction.
- **Visible thinking block** (when present) = the closest thing to an INDEPENDENT check on that self-report. Not a perfect readout of actual computation (chain-of-thought unfaithfulness is real and documented, including in Anthropic's own interpretability research -- the model can reach an answer via a path not fully reflected in the stated reasoning, or rationalize post-hoc) -- but critically, it isn't something the model was told to produce as a formality either. It let a user directly see whether the model appeared to engage with an injected pattern DURING its own reasoning, catching two failure modes the self-report footer can't:
  1. Model says `Context: used: X` (compliant self-report) without having meaningfully engaged with X
  2. Model draws on something injected but never mentions it in the footer (silent, unreported usage)

## Why this matters for contextus specifically

Contextus's entire calibration/usage-evaluation architecture (`lib/calibration/eval-worker-core.ts`, the Haiku-judged `weightedScore` pipeline, `usage-ratings.jsonl`) is built ON TOP OF the self-reported footer as ground truth for "was this injection useful." If visible thinking blocks go away (permanently, as an architecture change rather than a togglable setting -- per the unconfirmed report), the self-reported footer becomes the ONLY signal, with no independent cross-check available to a human reviewing a session live. This doesn't break calibration outright (the Haiku-judged eval already treats the footer's self-report with some skepticism, grading based on full context rather than trusting the footer blindly) -- but it does remove a cheap, real-time sanity check a user could previously do themselves, session by session, without waiting for a calibration eval pass.

## Not an action item, a design awareness note

No code change follows from this directly -- this is an EXTERNAL (model-behavior-level) change with a real downstream consequence for a system built this session, not something contextus's own architecture caused or can prevent. Worth remembering if usage-signal quality seems to degrade for Sonnet-5-heavy sessions going forward without any corresponding contextus code change -- the self-report-only signal (with no thinking-block cross-check available) may be part of why.

## Related

- `implementation/implementation-query-expansion.md`, `gotchas/gotcha-expansion-hallucination-inflates-injection-score.md` -- other places this session touched calibration/verification signal quality
- `tradeoffs/tradeoff-claude-code-hook-surface-limitations.md` -- the other Claude-Code-platform-level constraint documented this session
