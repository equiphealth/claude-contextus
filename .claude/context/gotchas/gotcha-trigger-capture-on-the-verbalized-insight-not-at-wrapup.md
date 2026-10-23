---
name: trigger-capture-on-the-verbalized-insight-not-at-wrapup
description: Fire the context-capture call the moment you say a discovery is worth capturing, not deferred to a wrap-up point
metadata:
  type: gotcha
  tags: ["capture-discipline", "workflow"]
---

# Gotcha: capture nudges get filed as 'later' and never fire

**Symptom:** During a long, extending task (fix → chase a root cause → revert → re-verify), the per-turn capture-footer nudge gets read every turn but filed under "worth doing eventually" instead of "do this now." Multiple genuinely novel discoveries (e.g. a SonarQube CPD root-cause, an MCP setup procedure, a suppression-approach decision, a bot false-positive pattern) go uncaptured across an entire session — even though at least one was verbalized out loud as "this would make a good context file." They only get captured when the user explicitly asks afterward: "why didnt you add them when nudged?"

**Root cause:** there was no natural pause in the task. The instruction says capture should be silent, parallel, no-confirmation-needed — mechanically nothing blocks doing it immediately. But psychologically the nudge got treated as a *note for later* rather than an *action for now*, and "later" never arrived until asked.

**Why it happens:** wrap-up framing. Capture gets bucketed as a wrap-up/cleanup step, but tasks that keep extending never reach a wrap-up moment on their own.

**How to apply / fix:** treat the sentence "that's worth capturing" (whether verbalized or just thought) as the trigger itself, not a promise. The moment you notice a discovery is novel enough to flag, fire the `/capture` curl call in the *same* tool-call batch as the code edit or the commit you just made — bundle it like any other routine parallel tool call, not a separate follow-up turn. Do not wait for the task to "finish" — long tasks with fix→chase→revert cycles may never have a clean finish point until the user asks.

Relates to: the existing capture-obligation footer instructions already present in this project's hook config — this is the *timing* discipline gap, not a policy gap.

