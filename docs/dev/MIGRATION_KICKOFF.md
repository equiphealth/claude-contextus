# Migration Kickoff Prompt

Paste-ready prompt to start the automation-project migration in a fresh
contextus-repo session (after `/clear`). Pairs with `docs/MIGRATION_GUIDE.md`.

**Why this lives here:** survives `/clear`; the global memory
`project_automation_contextus_migration` + the contextus-project
`automation-migration-plan` will auto-load and give you the plan, but this is the
explicit mandate + capture protocol to paste.

---

## The two-location reality (read first)

The migration is inherently split, so the prompt assigns both:

- **Drive from THIS contextus-repo session** — run `migrate-memory`, scaffold,
  embed, edit `settings.json`, fix skills/docs. All the editing lives here.
- **Validate from a SEPARATE automation-repo session** — live injection ("does
  context appear in thinking?") only happens by running
  `claude --plugin-dir ~/src/claude-contextus` *inside* the automation repo. I
  cannot self-verify that (same constraint as the Phase-2 live check). You drive
  those steps and report what you see.

---

## Paste this

> Lead me through a complete migration of the **automation** project
> (`~/src/my-equip-mobile/automation`) from its custom hooks + `.claude/memory/`
> setup to contextus. We're driving from **this contextus-repo session**.
>
> First load context: read the global memory `project_automation_contextus_migration`
> and the contextus-project memory `automation-migration-plan`, then
> `docs/MIGRATION_GUIDE.md` (the authoritative steps, fact-checked) and
> `docs/GAP_ANALYSIS.md` (what contextus does/doesn't replace). Confirm the known
> gotchas still hold (migrate-memory is repo-scoped; embed/query resolve from cwd;
> contextus-setup honors --dir; hooks are in settings.json; daemon port 37800).
>
> **Mandate — this migration is also a docs/skills validation pass.** As we go,
> track every step with one of:
> - ❌ **Blocker** — couldn't proceed without manual intervention
> - ⚠️ **Friction** — worked but awkward/unclear/undocumented
> - ✅ **Smooth** — worked as documented
> - 💡 **Discovery** — learned something not in the docs
>
> **Execution:**
> 1. Go step-by-step through MIGRATION_GUIDE.md. Stop at each phase boundary.
> 2. For editing steps (migrate-memory, embed, settings.json surgery, skill fixes)
>    — you do them here in the contextus session.
> 3. For **live-session steps** (does injection appear in thinking? does the
>    awareness footer show? does session-start auto-reconcile fire?) — tell me the
>    exact commands to run in a **separate automation-repo `claude --plugin-dir`
>    session**, what to look for, and I'll report back. You can't self-verify these.
> 4. Capture findings as we go (real-time), don't wait for a post-mortem.
>
> **Consider building a `/contextus-migrate` skill as step 0** (two halves:
> settings.json hook hygiene + project conversion) so the migration dogfoods it —
> see MIGRATION_GUIDE.md "Automating the Migration". Your call whether step-0 or
> extract-after.
>
> **Feed findings back into** (at the end, or inline when clearly right):
> - `docs/MIGRATION_GUIDE.md` — clarify ambiguous steps
> - `docs/GAP_ANALYSIS.md` — update with real findings
> - `/contextus-setup` skill — error handling, better prompts
> - a new `docs/MIGRATION_LESSONS.md` if the friction log is substantial
> - a new `/contextus-doctor` skill if recurring troubleshooting emerges
>
> Commit at each clean phase boundary (stage explicit paths only — never `git add -A`;
> leave Sonnet's `docs/GAP_ANALYSIS.md` edits alone unless I say otherwise).

---

## What this validates (the real test of v1)

Hook installation via settings.json · memory→context migration · first full embed ·
daemon auto-start + auto-reconcile · **live injection in a real session** ·
coexistence (old memory read-only alongside new context) · the floor on a *second,
different* corpus (automation ≠ contextus).

This is the first time contextus runs somewhere it wasn't built. Anything that only
worked because it was the contextus repo will surface here.
