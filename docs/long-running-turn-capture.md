# Long-Running Turn Capture

## Problem

During extended implementation sessions, multiple capture-worthy patterns emerge (gotchas, decisions, tradeoffs). The **workflow friction** is solved (staging mode + `/capture` endpoint), but **detection completeness** remains an open problem:

1. **Detection gaps** — Claude may not notice all capture-worthy moments during complex implementation work
2. **Working memory limits** — Implementation details crowd out capture awareness as turns get long
3. **Context decay** — By the time a turn ends, earlier discoveries have less surrounding context
4. **Batch blindness** — With 5+ patterns surfacing in one turn, later ones get less attention than earlier ones

## Current State (solved)

**Staging mode** is the default capture path (`contextCapture.mode: "staging"`):
- Claude writes context files directly *as discoveries surface* — capture FIRST, respond SECOND
- The `/capture` endpoint (v0.8.1) handles file writes via a single HTTP call — minimal UI noise
- User reviews via `git diff` / `git status` before committing
- Git workflow IS the quality gate — a false positive on a net-new file costs one `rm` (not `git checkout`, which is a no-op on something never committed — see `tradeoffs/tradeoff-context-index-cant-be-partially-staged.md` for the related `CONTEXT.md` index wrinkle once more than one capture is involved)

This solves the **workflow** problem. What remains is the **detection** problem.

## The Detection Problem

Even with staging mode instructing "capture as you go," Claude's attention during a long implementation turn is primarily on the implementation. Capture awareness competes with:

- Debugging focus (deep in a stack trace)
- Multi-file refactoring (tracking changes across files)
- Test-fix loops (iterating on failures)
- Complex architectural reasoning

The staging footer helps ("SELF-TEST: if your response contains bullets explaining something useful, those should be IN A CONTEXT FILE"), but it's a nudge, not a guarantee. A 45-minute implementation turn that surfaces 8 patterns might only capture 4-5.

## Potential Directions

### Stop hook scan (most promising near-term)

After a turn ends, a Stop hook scans the conversation for missed capture opportunities:
- Pattern-match for: decisions made, gotchas discovered, conventions established, surprising behaviors
- Cross-reference against what was actually captured during the turn
- Output: "Missed captures detected: X, Y — capture now?"
- Runs post-turn, so it doesn't interrupt implementation flow

**Tradeoffs:**
- Pro: Zero mid-turn cognitive load; catches what staging mode missed
- Con: Context is slightly staler (turn already ended); requires LLM call in Stop hook (~cost)
- Con: Stop hook is best-effort (not guaranteed to fire on crashes/timeouts)

### Capture queue (alternative)

Claude notes `[Queued: gotcha-lancedb-metadata]` inline during implementation, then batch-reviews at turn end. Lighter than writing files mid-turn but heavier than pure post-turn scan.

**Status:** Superseded by staging mode for most cases. Staging mode IS the queue — files appear in git status as the "queue," user reviews them all at once.

### Transcript mining (retrospective)

The upcoming transcript mining feature (next PR) operates on a different timescale — scanning *past sessions* for patterns that were never captured at all. Complementary to in-session detection: in-session catches the current turn, transcript mining catches everything that slipped through across all past sessions.

## Open Questions

- Can a Stop hook reliably detect missed opportunities without expensive full-conversation re-analysis?
- What's the signal for "this was capture-worthy"? (Decisions, surprising behaviors, gotchas, conventions — but how do you detect these programmatically?)
- Is the remaining detection gap large enough to justify the Stop hook cost, or does staging mode + transcript mining cover enough?
- Should the Stop hook use the same Haiku extraction as transcript mining (same pipeline, different trigger)?

## Related

- `POST /capture` endpoint (PR #12, v0.8.1) — the mechanical capture path
- Staging mode (PR #11) — write-first philosophy
- Transcript mining (next PR) — retrospective pattern extraction from past sessions
- V2 roadmap: CAE gate, quality signals

---

*Created: 2026-06-22 — exploratory, not committed direction*
