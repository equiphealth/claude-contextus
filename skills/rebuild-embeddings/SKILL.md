---
name: rebuild-embeddings
description: Intelligently re-embed the corpus — incremental by default (only changed/new files), full rebuild when needed (model switch, corruption). Reports what changed, what was skipped, what was removed.
---

# Rebuild Embeddings

Smart re-embed that does the minimum work needed. Unlike the daemon's auto-reconcile
(which only watches `.claude/context/`), this covers ALL sources — context, docs, user
packs — and reports exactly what happened.

## When to Use

| Trigger | Mode | What happens |
|---|---|---|
| Edited a few context files | Automatic (daemon reconcile) | Already handled, no action needed |
| Edited docs / added frontmatter | `/rebuild-embeddings` | Incremental: re-embeds changed docs |
| Bulk migration / many files changed | `/rebuild-embeddings` | Incremental: re-embeds all changed |
| Switched embedding model or provider | `/rebuild-embeddings --full` | Full: drops table, rebuilds from scratch |
| Corpus seems corrupted / wrong results | `/rebuild-embeddings --full` | Full: clean slate |
| Want to verify what's stale | `/rebuild-embeddings --dry-run` | Reports only, changes nothing |

## Usage

```bash
# Smart incremental (default) — only re-embeds files whose content changed
/rebuild-embeddings

# Dry-run — show what WOULD be re-embedded without doing it
/rebuild-embeddings --dry-run

# Full rebuild — drops table, re-embeds everything from scratch
/rebuild-embeddings --full

# Only re-embed docs (after adding frontmatter, for example)
/rebuild-embeddings --docs-only

# Only re-embed context files
/rebuild-embeddings --context-only

# Verbose — show per-file status
/rebuild-embeddings --verbose
```

Engine (dev/direct):

```bash
cd <target-project>
TSX=~/src/claude-contextus/node_modules/.bin/tsx

# Full rebuild (all sources — equivalent to --full)
$TSX ~/src/claude-contextus/scripts/embed-contexts.ts

# Incremental context reconcile (what the daemon does)
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d '{"project": "<name>", "cwd": "'"$(pwd)"'"}'
```

## How It Decides What to Re-embed

### Incremental mode (default)

For each source (context, docs, user packs):
1. Loads all markdown files from configured source directories
2. Computes content hash (SHA-256 of file content)
3. Compares against stored hashes in the LanceDB table
4. **New file** (no stored hash) → embed and insert
5. **Changed file** (hash differs) → re-embed and replace all chunks for that file
6. **Deleted file** (stored hash but no disk file) → remove orphan rows
7. **Unchanged** → skip (free)

### Full mode (`--full`)

Required when the vector space itself has changed:
- Different embedding model (vectors are incompatible across models)
- Different dimensions
- Provider switch (ollama → transformers or vice versa)
- Suspected corruption

Drops the entire LanceDB table and rebuilds from every file. Takes 15-30s for a
typical corpus (~100-200 files).

## Output

```
contextus rebuild (incremental)
  sources:  projectContext(.claude/context/), projectDocs(docs/)
  provider: ollama (nomic-embed-text, 768d)

Scanning...
  projectContext: 68 files (3 changed, 1 new, 2 removed, 62 unchanged)
  projectDocs:    12 files (4 changed, 0 new, 0 removed, 8 unchanged)

Embedding 8 chunks from 8 files...
  8/8

✓ Complete
  Embedded: 8 files (4 context, 4 docs)
  Removed:  2 orphan rows
  Skipped:  70 unchanged
  Time:     3.2s
```

## What the Daemon Handles Automatically

The daemon's `/reconcile` endpoint runs automatically on session start (via the
session-start hook). It covers:
- `.claude/context/` files only (not docs, not user packs)
- New files, changed files, deleted files
- Prefix↔type mismatches are quarantined (logged, not embedded)

**You need `/rebuild-embeddings` when:**
- You changed files in `docs/` (daemon doesn't watch those)
- You want to force a full rebuild (model change)
- You want to see what's stale without the daemon acting on it

## Related

- `/context-status` — shows stale file count and last rebuild time
- `/audit-context` — validates frontmatter quality before embedding
- `/contextus-setup` — initial embed during first-run setup
