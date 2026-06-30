---
name: context-archive
description: Archive low-value patterns — move noisy/stale/obsolete patterns to .claude/context/.archive/. Supports bulk operations (--stale, --unused) and single-file archival. Removes from LanceDB but preserves file content.
---

# context-archive

**Archive low-value patterns** — move noisy/stale/obsolete patterns to `.claude/context/.archive/`.

## When to use

- After `/context-stats` identifies noisy patterns (high retrieval, low usage)
- Periodic cleanup of stale patterns (not retrieved in 6+ months)
- Manual archival of obsolete patterns
- Suggested by `/context-review` for specific files

## How it works

1. Move file(s) from `.claude/context/<category>/` to `.claude/context/.archive/`
2. Delete corresponding LanceDB rows (pattern no longer retrieved)
3. Stage changes via `git mv`
4. Report what was archived

**Archived files are preserved** — they can be restored by moving back and re-embedding.

## Instructions

When this skill is invoked:

### Single File Mode

```
/context-archive decisions/decision-old-api.md
```

1. Validate file exists in corpus
2. Show stats (if available): score, retrieval count, last used
3. Confirm: "Archive this pattern? It will no longer be retrieved."
4. On yes:
   - `git mv .claude/context/decisions/decision-old-api.md .claude/context/.archive/`
   - Delete LanceDB rows matching this file path
   - Stage the move
5. Report: "✓ Archived decisions/decision-old-api.md"

### Bulk Mode: `--stale`

```
/context-archive --stale [--window 180]
```

1. Read usage.jsonl for all patterns
2. Filter to patterns not retrieved in `--window` days (default: 180)
3. Show list: filename, category, last retrieved (or "never")
4. Confirm: "Archive N stale patterns?"
5. On yes:
   - Move all to `.archive/`
   - Delete LanceDB rows
   - Stage changes
6. Report: "✓ Archived N patterns (not retrieved in 6mo)"

### Bulk Mode: `--unused`

```
/context-archive --unused [--threshold 0.2]
```

1. Read usage-ratings.jsonl
2. Filter to patterns with avgWeightedScore < threshold (default: 0.2) AND evalCount >= 10
3. Show list: filename, score, retrieval count
4. Confirm: "Archive N unused patterns?"
5. On yes: same as --stale
6. Report: "✓ Archived N patterns (avg score < 0.2)"

### Dry Run

```
/context-archive --stale --dry-run
```

Show what would be archived without actually moving files.

## LanceDB Cleanup

After moving files, delete rows from LanceDB:

```typescript
// Pseudo-code (actual implementation in lib/archive.ts)
async function deleteArchivedRows(filenames: string[]): Promise<void> {
  const table = await openTable(projectId);
  for (const filename of filenames) {
    await table.delete(`file = '${filename}'`);
  }
}
```

This ensures archived patterns don't appear in future retrievals.

## Archive Directory Structure

```
.claude/context/
  .archive/
    decision-old-api.md
    gotcha-legacy-bug.md
    reference-deprecated-endpoint.md
```

Files lose their category subdirectory when archived (flattened). This is intentional — archived patterns are not organized by category since they're not actively used.

## Restoration

To unarchive:

1. Move file back: `git mv .claude/context/.archive/pattern.md .claude/context/<category>/`
2. Re-embed: daemon auto-detects new file and embeds on next reconcile

## Arguments

**Single file:**
- `<file>` — Path to context file (relative to `.claude/context/` or absolute)

**Bulk:**
- `--stale` — Archive patterns not retrieved in `--window` days (default: 180)
- `--unused` — Archive patterns with avgWeightedScore < `--threshold` (default: 0.2)
- `--window N` — Days threshold for `--stale` (default: 180)
- `--threshold X` — Score threshold for `--unused` (default: 0.2)
- `--dry-run` — Show what would be archived without acting

## Requirements

- Write access to `.claude/context/.archive/`
- LanceDB table for current project
- Git repo (for staging moves)

## Cost

Zero — local file operations only, no LLM calls.

## Related Skills

- `/context-stats` — Identify archive candidates (noisy/stale patterns)
- `/context-review` — Interactive curation workflow (includes archive suggestions)
- `/context-doctor` — Health check (flags stale patterns)
- `/context-merge` — Merge duplicates before archiving one
