---
name: unified-db-scoping-invariant
description: Every unified DB operation (search, delete, keyword, reconcile) must scope by projectId/projectScope — unscoped operations leak or corrupt across projects
metadata:
  type: gotcha
  tags: [unified-db, workspace, data-integrity]
---

# Unified DB Scoping Invariant

With the unified database (`~/.contextus/data/contextus.lance`), all projects share one table. Every operation that touches rows MUST scope by project hash — not just writes.

## The invariant

| Operation | Scope mechanism |
|-----------|----------------|
| Vector search | `WHERE project IN (projectScope)` |
| Keyword/hybrid search | `loadCorpusForKeyword(project, projectScope)` with WHERE filter |
| Delete by filename | `deleteByFilename(file, project, projectFilter)` |
| Staleness check | `getContentHashes(project, source, projectFilter)` |
| Reconcile orphan cleanup | Pass `projectId` to `embedSingleFile()` and `deleteByFilename()` |
| Row ID generation | Prefix with `${project}:` for global uniqueness |

## What breaks without it

1. **Cross-project collisions**: Two projects with `decisions/decision-auth.md` overwrite each other's rows (same id without project prefix)
2. **Leaked search results**: Keyword search returns another project's patterns because corpus loaded unscoped
3. **Cascade deletes**: `deleteByFilename('config.md')` wipes that filename from ALL projects
4. **Phantom staleness**: `getContentHashes()` returns hashes from other projects → current project's files appear "already embedded" and get skipped

## Smell test for new code paths

When adding any code that calls lance-client functions, ask:

1. Does it pass `projectId`/`projectFilter`/`projectScope`?
2. If it generates row IDs, do they include the project prefix?
3. If it caches results, is the cache key scope-aware?

If the answer to any is "no", it's a bug — even if it appears to work in single-project testing.

## Related

- `gotcha-empty-project-stamp.md` — specific instance: missing project stamp at embed time
- `gotcha-project-identifier-mismatch.md` — mismatched identifiers between daemon and embed
