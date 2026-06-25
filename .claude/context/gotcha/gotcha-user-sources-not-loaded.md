---
name: user-sources-not-loaded
description: "[FIXED 2026-06-25] User-scoped context sources defined in config but never embedded - only projectContext actually loads"
metadata:
  type: gotcha
  tags: [sources, embedding, multi-source, resolved]
---

**STATUS: FIXED** (2026-06-25) — All enabled sources now load. See `implementation/implementation-multi-source-loading.md` for details.

# Problem

The plugin.jsonc defines multiple source types:
- `projectMemory` (scope: project) → `.claude/context/`
- `projectDocs` (scope: project) → `docs/`
- `userMemory` (scope: user) → `~/.contextus/context/`
- `userDocs` (scope: user) → `~/.contextus/docs/`

All are marked `"enabled": true`. The reranker has `sourceWeights` for 5 source types (projectContext, projectDocs, userContext, siblingContext, parentContext).

**But only `projectContext` is actually embedded and loaded.**

## Why

The reconciliation code (`lib/embedding/reconcile-run.ts`) hardcodes:
```typescript
rows.push(...buildRows(c, pending, vectors, 'projectContext', now, projectId));
```

And the daemon (`daemon/server.ts`) only calls `runReconcile()` once with the project's `.claude/context/` directory:
```typescript
runReconcile(contextDir, project, projectId)
```

User-scoped sources are never processed. The architecture was designed for multi-source (rerank weights prove it), but the implementation only shipped project sources.

## Impact

- Files in `~/.contextus/context/` never get embedded
- Cross-project patterns can't be shared
- The `userContext` rerank weight (0.8) is dead code
- `introspect?project=X` shows `"packs": ["projectContext"]` (missing userContext, projectDocs, etc)

## Evidence

```bash
curl -s 'http://127.0.0.1:37800/introspect?project=<hash>' | jq '.packs'
# Returns: ["projectContext"]
# Should be: ["projectContext", "projectDocs", "userContext", "userDocs"]

curl -s 'http://127.0.0.1:37800/introspect?project=<hash>' | jq '.rerankWeights.sourceWeights'
# Shows weights for userContext (0.8) but that source is never loaded!
```

## Fix

Options:

1. **Call runReconcile multiple times** (once per enabled source):
   ```typescript
   await runReconcile(projectContextDir, project, projectId, 'projectContext');
   await runReconcile(projectDocsDir, project, projectId, 'projectDocs');
   await runReconcile(userContextDir, undefined, '', 'userContext'); // no project scope
   ```

2. **Refactor runReconcile to accept source configs** instead of a single dir

3. **Separate user corpus** that merges at query time (unified DB already supports this)

The unified DB design (with `source` column) suggests option 1 or 2 - all sources go into the same table, distinguished by the `source` column value.

## Related

- `plugin.jsonc` lines 104-130: source definitions with scope=user that are never loaded
- `lib/retrieval/reranker.ts`: has sourceWeights that assume multiple sources exist
- Design docs likely specified multi-source but reconciliation only partially implemented it
