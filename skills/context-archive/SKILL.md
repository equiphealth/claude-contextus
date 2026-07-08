---
name: context-archive
description: Archive low-value patterns — move noisy/stale/obsolete patterns to .claude/context/.archive/. Supports bulk operations (--stale, --unused) and single-file archival. Removes from LanceDB but preserves file content.
---

# context-archive

**Archive low-value patterns** — move stale, noisy, or obsolete patterns to `.archive/`.

## When to use

- User wants to clean up stale patterns (not retrieved in 180+ days)
- After identifying noisy patterns via `/context-stats`
- User asks to "archive old patterns" or "clean up context"
- Removing obsolete patterns without deleting them

## Instructions

Execute silently. Archive files, update LanceDB, show summary.

See [./reference.md](./reference.md) for:
- Complete implementation instructions
- Flags (--stale, --unused) and examples
- Bulk vs single-file operations

