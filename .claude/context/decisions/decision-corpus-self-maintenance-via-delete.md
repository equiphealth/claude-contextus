---
name: corpus-self-maintenance-via-delete
description: Proactively archive corpus content when it goes stale — a problem gets solved, a decision gets superseded, a phase completes — not just for gotchas/bugs
metadata:
  type: decision
  tags: ["corpus-management", "workflow", "delete-endpoint"]
---

# Decision: Corpus Self-Maintenance via /delete

## Context

`decisions/decision-bug-documentation-lifecycle.md` already covers ONE instance of this problem: a `gotcha` describing a live bug becomes actively misleading once the bug is fixed, so it gets archived (via `/delete`, as of PR #34) and replaced with an `implementation` note.

But bugs aren't the only category that goes stale. The corpus has at least four categories whose whole *point* is to describe a state that changes:

| Category | Describes | Goes stale when |
|---|---|---|
| `gotcha` | an active problem | the bug is fixed |
| `decision` | a choice that was made | a later decision supersedes it |
| `phase` | in-progress design/implementation plan | the phase ships (or is abandoned) |
| `tradeoff` | an open tension being weighed | the tension resolves one way |
| `question` | something unresolved | the question gets answered |

Without an active habit of archiving these, the corpus accumulates content that's not just useless but **actively wrong** — e.g. a `decision` doc recommending approach A, injected into a session, when a later decision switched to approach B. The reader (a future Claude session) has no way to know the doc is outdated unless someone removes it.

## Decision

**Whenever work in this session resolves something a context file describes, archive that file via `/delete` in the same commit as the resolving change** — don't wait to be asked, and don't just leave it for a future `/context-archive --stale` sweep (that catches *unused* patterns via retrieval stats; it has no way to know a decision was superseded — only a human or an in-the-moment Claude session watching the conversation does).

Concretely, when you notice ANY of:
- A `gotcha` you just fixed → archive it, write an `implementation` note (see bug-documentation-lifecycle)
- A `decision` this session just contradicted or replaced → archive the old one, capture the new one (optionally referencing the old file's archived path for history)
- A `phase` doc whose plan just shipped → archive it (the shipped feature's real behavior lives in the code + CHANGELOG now, not the plan)
- A `tradeoff` that just got resolved one way → archive it, optionally capture a `decision` recording which way it went and why
- A `question` that just got answered → archive it, optionally fold the answer into a `reference` or `decision`

```bash
curl -s -X POST http://127.0.0.1:37800/delete \
  -H 'content-type: application/json' \
  -d '{"relPath":"<category>/<category>-<slug>.md","cwd":"'"$(pwd)"'"}'
```

This is a **capture-adjacent obligation**, not a separate task to remember later: the same instinct that says "this insight is worth capturing" (per `docs/CAPTURE_PHILOSOPHY.md`) should also say "that OTHER file I captured earlier is now wrong, archive it."

## Rationale

1. **A stale decision is worse than no decision** — an injected context block carries no timestamp visible to the reader; if it recommends something superseded, it actively misdirects rather than just failing to help
2. **Only the in-context session knows the causal link** — `/context-archive --stale` and `--unused` work off retrieval/usage stats, which can't distinguish "nobody happened to ask about this" from "this is provably wrong now." A session that just made the superseding decision is the only place that link is legible.
3. **Archive, never hard-delete** — same reasoning as `/delete`'s own design: if the resolution turns out to be wrong (the fix gets reverted, the decision gets re-reversed), the archived file is one `mv` back into place, not a `git log -p` archaeology exercise
4. **Cheap to do, expensive to skip** — one `/delete` call in the same commit vs. a future session reading stale advice, acting on it, and someone eventually having to debug why

## When NOT to archive

- The old content still has valid historical value even though it's superseded (e.g. "why we tried X before switching to Y" is worth keeping as a `decision` in its own right, not just deleting the X doc) — in that case, capture a NEW decision documenting the switch and its rationale, and only archive the old one if it would actively mislead a reader who doesn't also see the new one
- A `phase` doc that's genuinely paused, not shipped or abandoned — leave it; archiving implies "this is resolved," not "this is on hold"
- Multiple sessions/agents might be relying on the old doc's existence mid-task — check for that before archiving something that isn't clearly yours to resolve (see `project/project-v2-roadmap-ownership.md`-style parallel-agent collision concerns)

## Related

- `decisions/decision-bug-documentation-lifecycle.md` — the bug-specific instance of this pattern (predates this doc; this generalizes it)
- `phase/phase-context-delete-archive-endpoint.md` — the design doc for `/delete` itself
- `docs/CAPTURE_PHILOSOPHY.md` — the capture-side half of corpus hygiene; this is the removal-side half
- `/context-archive` skill — the user-facing/bulk-facing entry point that also calls `/delete`, but driven by usage stats rather than in-session knowledge
