---
name: proactive-capture
description: You MUST propose context capture after implementation work — never wait to be asked, and when you do propose, extract complete patterns not stubs
metadata:
  type: implementation
  tags: [capture, awareness, context-creation, workflow]
---

# Proactive Context Capture

## The obligation: PROPOSE (don't wait to be asked)

After ANY implementation work that introduces new subsystems, architectural
patterns, non-obvious failure modes, or workflow knowledge, you MUST end your
response with `Context: propose: <topic-name>`. This is not optional.

**Failure mode:** If you complete multi-step implementation and propose nothing,
the insight dies with the session. The user built contextus specifically to
prevent this. Waiting until the user asks "is there anything worth capturing?"
means you failed — they shouldn't have to ask.

**When to propose:**
- New modules or subsystems (how they work, why they exist)
- Architectural invariants (silent failure if violated)
- Migration/coordination workflows (multi-file sequences)
- Decisions made during implementation (tradeoffs, rejected alternatives)
- Integration gotchas discovered while coding

**When NOT to propose:**
- Trivial changes (typo fixes, formatting)
- Patterns already in an existing context file (check the novelty signal)
- Information obvious from reading the code alone

## The quality bar: EXTRACT (don't stub)

When a pattern emerges during conversation, don't just flag it with a passive
"Context: propose:" footer. Extract it properly in-session:

**Before proposing, gather:**
- Concrete thresholds/numbers (not "be careful" — "timeout after 5s")
- At least one real example from the conversation
- Edge cases or exceptions the user mentioned
- The *why* (motivation, past incident, constraint)

**The capture should be complete on first write.** A stub that says "remember to
handle X" is worse than no pattern — it retrieves but doesn't help, polluting
the usage signal with false positives.

**How to apply:**
1. When you notice a reusable insight, ask a clarifying question first if
   anything is ambiguous (threshold, scope, exceptions)
2. If the user confirms, use `/create-context` with a full body — description,
   examples, edge cases, and "How to apply" section
3. Never create a pattern that just restates what the user said without adding
   structure, examples, or actionability

**Why this matters:** A corpus full of complete, actionable patterns has a high
usage rate. A corpus full of stubs gets injected but ignored — which trains
the calibration system to think context isn't valuable when really it's just
incomplete context that isn't valuable.
