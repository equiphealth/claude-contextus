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

Each file archives via one call to the daemon's `/delete` endpoint, which does the whole operation atomically:

1. Move the file from `.claude/context/<category>/` to `.claude/context/.archive/` (flattened)
2. Remove its `CONTEXT.md` index entry
3. Delete its LanceDB rows (pattern no longer retrieved)

**Archived files are preserved** — they can be restored by moving back and re-embedding (see Restoration below).

## Instructions

When this skill is invoked, call the daemon for each file to archive:

```bash
curl -s -X POST http://127.0.0.1:37800/delete \
  -H 'content-type: application/json' \
  -d '{"relPath":"decisions/decision-old-api.md","cwd":"'"$(pwd)"'"}'
```

Response:
```json
{
  "ok": true,
  "archived": "/abs/path/.claude/context/.archive/decision-old-api.md",
  "archivedRelPath": ".archive/decision-old-api.md",
  "removedFromIndex": true,
  "embeddingsRemoved": true
}
```

`relPath` is relative to `.claude/context/` (or `~/.contextus/context/` for `scope: "user"` — add `"scope":"user"` and drop `cwd`). `/delete` never returns `{continue:true}` on failure — a bad request or missing file comes back as an honest `{ok:false, error}`, so check `.ok` rather than assuming success.

### Single File Mode

```
/context-archive decisions/decision-old-api.md
```

1. Validate file exists in corpus
2. Show stats (if available): score, retrieval count, last used
3. Confirm: "Archive this pattern? It will no longer be retrieved."
4. On yes: call `/delete` with that `relPath`
5. Report: "✓ Archived decisions/decision-old-api.md"

### Bulk Mode: `--stale`

```
/context-archive --stale [--window 180]
```

1. Read usage.jsonl for all patterns
2. Filter to patterns not retrieved in `--window` days (default: 180)
3. Show list: filename, category, last retrieved (or "never")
4. Confirm: "Archive N stale patterns?"
5. On yes: call `/delete` once per file (sequentially — the daemon has no bulk endpoint)
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

Show what would be archived without calling `/delete`.

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

No dedicated endpoint for this in v1 — restore manually:

1. Move file back: `mv .claude/context/.archive/pattern.md .claude/context/<category>/` (`git mv` if you want the move staged)
2. Re-embed: daemon auto-detects the file back inside the watched context dir and embeds it on next edit/reconcile

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

- contextus daemon running (`/manage-daemon status` to check) — `/delete` is a daemon endpoint, not a local script
- Write access to `.claude/context/.archive/`

## Cost

Zero LLM calls — `/delete` is a local file move + LanceDB delete, no embedding call on the removal path.

## Related Skills

- `/context-stats` — Identify archive candidates (noisy/stale patterns)
- `/context-review` — Interactive curation workflow (includes archive suggestions)
- `/context-doctor` — Health check (flags stale patterns)
- `/context-merge` — Merge duplicates before archiving one
