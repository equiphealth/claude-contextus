---
name: empty-project-stamp
description: buildRows() defaults project to empty string — rows become invisible to workspace-scoped queries with no error
metadata:
  type: gotcha
  tags: [unified-db, embedding, workspace]
---

# Empty Project Stamp Footgun

`buildRows()` in `lib/embedding/file-to-rows.ts` accepts an optional `project` parameter that defaults to `''` (empty string).

## The problem

If a caller forgets to pass `projectId`:

1. Rows are embedded successfully (no error)
2. They get `project: ''` stamped on every row
3. Workspace-scoped queries use `WHERE project IN [selfHash, ...siblings, '__user__']`
4. Empty string is never in that list
5. The rows are effectively invisible — they exist in the DB but never surface in search results

## Why it's dangerous

- No error at embed time or query time
- The only symptom is "my context isn't being retrieved" — which has many other causes
- The rows still appear in `vectorstore count` checks, so the corpus looks healthy

## Prevention

Every call chain that reaches `buildRows()` or `embedSingleFile()` must thread `projectId` through:

- `daemon/server.ts` → `handleNotify()` computes `projectHash(projectRoot)` and passes it
- `daemon/server.ts` → `handleReconcile()` same
- `scripts/embed-contexts.ts` computes `projectHash(process.cwd())`

If adding a new embedding entry point, always compute `projectHash()` early and pass it down. Never rely on the default.
