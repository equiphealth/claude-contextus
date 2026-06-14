---
name: first-run-onboarding
description: Phase-6 first-run onboarding — auto-reconcile a cold corpus in the background + a /contextus-setup skill that owns CLAUDE.md edits
metadata:
  type: project
  tags: [onboarding, session-start, setup, claude-md, embedding, phase-6]
---

**Gap caught (2026-06-14):** session-start ensures the daemon is *running* but never checks whether the project's *corpus exists*. A fresh install with a populated `.claude/context/` but no LanceDB table hits `tableExists=false` in `/query` → injects nothing → silently forever, until someone runs `pnpm run embed` by hand. For a "context finds you" system, an invisible cold-start that finds nothing is the worst trust failure. Neither existing skill closes it (`configure` tunes paths but never embeds; `rebuild-embeddings` is a manual repair tool, not onboarding).

**Decision (2026-06-14): build in Phase 6** (it's out-of-box/hardening, not a standalone phase). Two halves split by risk:

1. **Auto-reconcile — silent safety net, in the session-start hook.** Detect cold/stale corpus (context files exist but table missing or behind on count/hashes) → fire a **background** reconcile via the daemon (`/reconcile` endpoint, or per-file `/notify` — the Phase-3 staleness skip makes it cheap + idempotent). Background so it never blocks the 20s session-start window. Reports via `systemMessage` per `notifications.verbosity`. **Plus a one-time nudge:** if no contextus stanza in the project CLAUDE.md, suggest `/contextus-setup` (decision: embed + nudge, not embed-only — discoverability).

2. **`/contextus-setup` skill — the explicit half.** Scaffold `.claude/context/` + starter `CONTEXT.md`; drop a contextus stanza into CLAUDE.md inside a **marked, idempotent** block (`<!-- contextus:start --> … <!-- contextus:end -->`); initial embed; confirm daemon; print status.

**Firm constraint:** a hook must NEVER auto-edit CLAUDE.md — outward-facing, user-owned. Cheap invisible embed may be automatic; the visible file edit is opt-in, behind a marked block, owned solely by the skill. The stanza also makes the Phase-3 awareness/propose loop legible to a fresh instance.

Recorded in `docs/IMPLEMENTATION_ESTIMATE.md` ("First-Run Onboarding") + the Phase-6 prompt in `docs/BUILD_PROMPTS.md`.

**Related**: [[build-execution-cadence]], [[memory-to-context-migration]], [[selfdoc-build-practice]]
