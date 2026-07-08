---
name: migrate-memory
description: Convert .claude/memory/ to .claude/context/ with proper typing, tags, and retrieval-optimized frontmatter
---

# migrate-memory

**Migrate legacy memory** — convert `.claude/memory/` → `.claude/context/`.

## When to use

- User has existing `.claude/memory/` files to convert
- During initial contextus setup (wizard offers this)
- User asks to "migrate memory" or "convert memory to context"

## Instructions

Conversational wizard. Show dry-run first, confirm before writing.

See [./reference.md](./reference.md) for:
- Complete migration workflow
- Scope triage (user vs project)
- Implementation details
