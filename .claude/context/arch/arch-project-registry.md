---
name: project-registry
description: Lazy project registry at ~/.contextus/data/projects.json maps hash→path/name for readable UX and bidirectional resolution
metadata:
  type: arch
  tags: [project-identity, workspace, unified-db, ux]
---

# Project Registry (hash ↔ path reverse lookup)

## Problem

projectId hashes (sha256 12-char) are opaque. Status output, logs, and CLI flags
become unreadable when users only see "a1b2c3d4e5f6" instead of "automation".

## Solution

A lazy-populated JSON file at `~/.contextus/data/projects.json`:

```json
{
  "a1b2c3d4e5f6": { "path": "/Users/.../my-project", "name": "my-project", "lastSeen": "2026-06-24T..." }
}
```

## How It Populates

Every daemon handler that receives both `projectId` and `cwd` calls:
```typescript
registerProject(projectId, cwd);
```

Write-on-change only — if the hash is already mapped to the same path, it just
bumps `lastSeen` (skipped entirely if already today). Zero setup required.

## What It Unlocks

- **Status output**: shows "automation" not "a1b2c3d4e5f6"
- **CLI flags**: `--project automation` resolves to hash via `resolveProjectId()`
- **Logs**: daemon can display friendly names in log lines
- **Future**: daemon could look up `cwd` from hash alone (drop cwd requirement for some endpoints)

## API (lib/workspace.ts)

| Function | Purpose |
|----------|---------|
| `registerProject(id, path)` | Upsert entry (idempotent, write-on-change) |
| `projectName(id)` | Hash → friendly name (returns hash if unknown) |
| `projectPath(id)` | Hash → absolute path (null if unknown) |
| `resolveProjectId(nameOrHash)` | Accepts name, hash, or path — returns hash |
| `listProjects()` | All registered projects |

## Relation to Workspaces

The workspace system (`~/.contextus/workspaces/*.jsonc`) stores explicit cross-project
links with paths. The registry complements it by tracking ALL projects the daemon has
ever seen — including standalone ones never linked to a workspace. Workspaces define
scope; the registry defines identity.

## Edge Cases

- **Project moved/renamed**: next session overwrites the entry (same hash because
  the hash is of the OLD path... actually this creates a new hash). So stale entries
  accumulate — `lastSeen` enables future pruning.
- **Name collision**: two dirs named "automation" at different paths get different hashes
  but same `name`. `resolveProjectId("automation")` returns the first match. Disambiguate
  with path or hash.
