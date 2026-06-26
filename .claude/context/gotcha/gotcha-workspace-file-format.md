---
name: workspace-file-format
description: Workspace JSONC files require projects as array of objects with path property, not array of strings
metadata:
  type: gotcha
  tags: [workspaces, linked-projects, config, format]
---

# Problem

When creating a workspace file manually, it's easy to write:

```jsonc
{
  "name": "my-workspace",
  "projects": [
    "~/src/project-a",
    "~/src/project-b"
  ]
}
```

This **silently fails** — the workspace loads but has 0 projects, and linked context never appears in queries.

## Why

The `readWorkspaceFile()` parser expects **objects with a `path` property**:

```typescript
projects: raw.projects.filter((p: any) => p && typeof p.path === 'string')
```

String array entries fail the `typeof p.path === 'string'` check and get filtered out.

## Correct Format

```jsonc
{
  "name": "my-workspace",
  "description": "Optional description",
  "projects": [
    { "path": "~/src/project-a" },
    { "path": "~/src/project-b" }
  ]
}
```

Each project must be an **object** with a `path` field. Tilde expansion and relative paths are supported.

## How to Detect

If `loadWorkspaces()` returns a workspace with `projects.length === 0` but the file lists paths, the format is wrong.

Test with:
```typescript
import { loadWorkspaces } from './lib/workspace.js';
const all = loadWorkspaces();
all.forEach(ws => {
  console.log(`${ws.name}: ${ws.projects.length} projects`);
});
```

## Why Objects Not Strings?

Future extensibility — the object format allows adding per-project metadata like:
```jsonc
{ "path": "~/src/project", "weight": 0.9, "priority": "high" }
```

Without breaking existing workspace files.

## Related

- `lib/workspace.ts` line 33: the filter that requires `typeof p.path === 'string'`
- `decision/decision-unified-db-workspaces.md`: workspace architecture rationale
