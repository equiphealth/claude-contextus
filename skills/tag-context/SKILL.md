---
name: tag-context
description: Find tagless context files and backfill sensible tags from their content (you propose, user approves). Tags are stored-but-inert until v2 CAE consumes them.
---

# Tag Context

Backfill `tags` on context files that don't have any. The memory→context migration
deliberately never fabricated tags, so some files arrived tagless. Tags are inert
until the v2 CAE consumes them, but this gives a path to seed them now so the
corpus is ready when tag-driven gating lands.

## When to Use

- After `/migrate-memory` (which leaves tagless files by design).
- Any time `/context-status` or you notice context files without tags.
- Re-runnable: it only touches files that are still tagless, and writing the same
  tags twice is a no-op.

## How It Works

The proposal step is offloaded to a **lightweight subagent**, not the (expensive)
session model — "read a file, suggest 3-5 topic tags" is a small bounded task.

1. **List** — `pnpm tag-context --list` returns the tagless files (relpath, name,
   description) as JSON. This CLI is a pure deterministic engine: no model call.
2. **Propose (subagent)** — dispatch a subagent with a **lightweight model**
   (default `claude-haiku-4-5-20251001`; configurable — see below) to READ the
   tagless files and propose 2-5 topical tags each from their actual content (not
   guessed from filenames). Tell it to prefer the existing corpus tag vocabulary
   (sample other files' `metadata.tags` + `docs/CATEGORIES_AND_TAGS.md`) so tags
   stay consistent. The subagent returns `{relpath → [tags]}`; batch the files into
   one subagent call rather than one-per-file. Use the `Agent`/Task tool with the
   model set to the lightweight default.
3. **Approve** — show the user the subagent's proposals; they confirm or edit per
   file. Tags are never written without approval.
4. **Apply** — `pnpm tag-context --apply <relpath> tag1,tag2,tag3` writes the
   approved tags into the file's frontmatter (nested `metadata.tags`, idempotent,
   preserves everything else). Add `--embed` to re-embed the file immediately.

### Proposal model (configurable)

The subagent that proposes tags defaults to a lightweight model (Haiku) — a tag
suggestion doesn't warrant the session model. To override, the user can name a
different model when invoking the skill ("use sonnet for tagging") or, offline,
point at a local Ollama model. The deterministic `--list`/`--apply` engine never
calls a model, so only this proposal step is affected.

## Usage

```bash
# 1. Find what's tagless
pnpm tag-context --list

# 2. (a lightweight Haiku subagent reads the files + proposes tags; you approve)

# 3. Write approved tags to a file
pnpm tag-context --apply decisions/decision-injection-format.md injection,ux,attention

# 3b. …and re-embed it right away
pnpm tag-context --apply gotchas/gotcha-foo.md lancedb,gotcha --embed
```

## Safety

- **You propose, the user approves** — tags are never auto-written from a guess.
- **Idempotent** — applying tags already present is a no-op; safe to re-run.
- **Scoped** — refuses to write outside `.claude/context/`.
- **Content-preserving** — only the frontmatter `tags` field changes; body and
  other frontmatter keys are untouched.

## Note on Value

Tags are **stored but inert in v1** — nothing reads them yet. They future-proof the
corpus for the v2 CAE's tag-driven gating (`docs/CATEGORIES_AND_TAGS.md` §8,
`docs/CONTEXT_APPLICABILITY_EVALUATOR.md`). Seeding them now is cheap; backfilling a
large corpus later is not.

## Related

- `/migrate-memory` — the source of tagless files (never fabricates tags)
- `/create-context` — authoring new context (tag at creation time)
- `docs/CATEGORIES_AND_TAGS.md` — the tag vocabulary
