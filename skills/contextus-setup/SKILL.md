---
name: contextus-setup
description: First-run setup for a project — scaffold .claude/context/, register contextus in CLAUDE.md (marked, idempotent block), run the initial embed, confirm the daemon. The only thing that edits CLAUDE.md.
---

# Contextus Setup

One-time onboarding for a project. Gets contextus from "installed" to "actively
injecting your patterns" — the step the silent session-start safety net can't take
because it must never edit your CLAUDE.md.

## When to Use

- **First time** in a project after installing the plugin (the session-start nudge
  points you here).
- After moving/renaming the project (re-register the stanza).
- Re-run anytime — it's idempotent (won't duplicate the CLAUDE.md block or
  re-embed unchanged files).

## What It Does

| Step | Detail |
|---|---|
| **Scaffold** | Creates `.claude/context/` + a starter `CONTEXT.md` index if absent |
| **Configure** | Asks setup questions (see below) and writes answers to plugin.json config |
| **Register** | Upserts a **marked, idempotent** stanza into the project `CLAUDE.md` inside `<!-- contextus:start -->` … `<!-- contextus:end -->` — re-running updates in place, never appends a duplicate |
| **Embed** | Runs the initial corpus embed (reconcile from the context files) |
| **Confirm** | Reports row count + reminds you context now injects automatically |

## Setup Questions

During first-run, the user is asked:

1. **Docs frontmatter** — "Should contextus manage frontmatter on your `docs/` files?
   This adds `name`, `description`, `type`, and `tags` to docs for better retrieval.
   Say no if your docs are shared with other tools or you don't want them modified."

   Sets `config.docs.requireFrontmatter` (`true` | `false`, default `false`):
   - `true` → `/audit-context` checks docs for missing frontmatter,
     `/migrate-memory --docs` offers to backfill, `/create-doc` is the recommended way
   - `false` → docs embed as-is (type=unknown, no tags), audit skips them,
     `/create-doc` still adds frontmatter (you invoked it, you want it)

The CLAUDE.md stanza tells a fresh Claude instance that context is injected here
and that new patterns can be proposed via the awareness footer — making the
capture loop legible instead of mysterious.

## Why this is the ONLY thing that edits CLAUDE.md

A hook fires every session; silently rewriting an outward-facing, user-owned file
every session is invasive. So the split is deliberate (first-run-onboarding
decision):

- **Automatic, invisible:** session-start detects a cold/stale corpus and embeds
  it in the background. Cheap, reversible, touches only `~/.contextus/data/`.
- **Opt-in, visible:** this skill is the only writer of `CLAUDE.md`, behind a
  marked block you can see and remove.

## Usage

```bash
/contextus-setup                  # set up the current project
```

Engine (dev/direct). Run the repo-local `tsx` **by path** — NOT `pnpm` (the
contextus repo needs Node 22 and your shell may be on a different Node, so `pnpm`
errors out):

```bash
cd <target-project>   # the project to set up (cwd = its corpus)
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/contextus-setup.ts              # current project (cwd)
# flags: --dir <path> (a specific project root) · --no-embed (scaffold + stanza only)
```

## Idempotency

Run it twice and the second run:
- leaves `.claude/context/` and `CONTEXT.md` as-is,
- **updates the CLAUDE.md stanza in place** (no second block),
- re-embeds only changed files (unchanged ones are skipped by the staleness gate).

## Related

- `/create-context` — capture your first pattern
- `/migrate-memory` — convert legacy `.claude/memory/` files into the corpus
- `/context-status` — health dashboard once you're set up
