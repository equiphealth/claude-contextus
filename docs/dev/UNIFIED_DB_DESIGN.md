# Unified Database & Workspaces Design

**Status**: Design (replaces per-project DB architecture)  
**Related**: V2_ROADMAP.md, SILENT_CAPTURE_V2.md, linked-projects (PR #10)  
**Supersedes**: Per-project isolation model (`~/.contextus/data/<project>/`)

## Problem

The per-project DB model creates problems at scale:
- Linked projects duplicate rows across DBs
- N projects linked to each other = N DBs with overlapping data
- Bidirectional linking doesn't fit a directed model (A→B ≠ B→A)
- The daemon manages N connections, N reconcile paths, N watchers

## Core Insight

A single DB with a `project` column is simpler, eliminates duplication, and
makes workspace-style grouping trivial (just a WHERE clause on query).

## Architecture

### Single DB

```
~/.contextus/data/contextus.lance    ← one DB for all projects
~/.contextus/workspaces/             ← workspace definitions (one file each)
```

Every row includes a `project` field — a short hash of the project's absolute
path (`sha256(absolutePath).slice(0, 12)`). This is opaque internal machinery,
never shown to users. It guarantees uniqueness (two projects named "api" in
different paths coexist), eliminates the basename-vs-absolute-path mismatch bug,
and means every codepath (hooks, embed script, daemon) computes the same key
from the same input with no normalization.

Row IDs are globally unique: `<projectHash>:<relative-path>:<chunk_index>`.

The daemon maintains a runtime lookup (`hash → { absolutePath, basename }`)
built at startup from workspace files + active project. Logging and display use
the friendly basename; the DB uses the hash.

### Workspaces

A workspace groups projects that share context bidirectionally.

```jsonc
// ~/.contextus/workspaces/my-platform.jsonc
{
  "name": "my-platform",
  "projects": [
    { "path": "~/src/api-service" },
    { "path": "~/src/frontend" },
    { "path": "~/src/shared-lib" }
  ]
}
```

- One file per workspace under `~/.contextus/workspaces/`
- Project `path` is the source of truth (basename derived at runtime)
- A project can belong to multiple workspaces (union of all siblings at query time)

### Query Scoping

When a query arrives from project `X`:

1. Resolve which workspaces `X` belongs to
2. Collect all sibling project names from those workspaces
3. Query: `WHERE project IN ('X', 'sibling-1', 'sibling-2', ...)`
4. Apply proximity weighting in reranker

Projects NOT in any workspace: query scoped to `WHERE project = 'X'` only.

### Weighting

Proximity-based, relative to the active project:

| Source | Weight |
|--------|--------|
| Own project's patterns | `projectContext` (1.0) |
| Sibling project patterns | `siblingContext` (0.85 default) |
| Personal context (`~/.claude/memory`) | `userContext` (0.8) |
| Personal docs (`~/.claude/docs`) | `userDocs` (0.7) |

`siblingWeight` is configurable globally or per-project in `.claude/contextus.jsonc`:

```jsonc
{
  "retrieval": {
    "siblingWeight": 0.85
  }
}
```

The weight is a function of *which project you're querying from*, not a
property of the workspace. Different projects in the same workspace can
weight siblings differently.

### Personal Context (Implicit Cross-Project)

User-level sources (`~/.claude/memory`, `~/.claude/docs`) are NOT workspace-gated.
They're always included in queries regardless of workspace membership — same as
today. They get their own SOURCE_WEIGHTS and don't need explicit linking.

Stored with `project: '__user__'` (or similar sentinel) so they're always in
the query scope without workspace membership.

## Row Schema Changes

```typescript
interface ContextRow {
  id: string;           // '<projectHash>:<relative-path>:<chunk_index>'
  project: string;      // sha256(absolutePath).slice(0, 12) — opaque, stable
  vector: number[];
  document: string;
  filename: string;     // relative path within project's context dir
  chunk_index: number;
  heading: string;
  type: string;
  source: string;       // projectContext | projectDocs | userContext | userDocs
  tags: string;
  hit_count: number;
  last_hit: string;
  updated_at: string;
  content_hash: string;
}
```

Only additions: `project` column. The `source` column remains (distinguishes
context vs docs within a project). The `linkedContext` source value goes away —
siblings are just `projectContext` from a different project.

The `project` value is a hash, not a name. Benefits:
- Two `~/work/api` and `~/personal/api` coexist without collision
- Hooks pass absolute path → hash it → always matches embed-time key
- Kills the basename-vs-absolute-path mismatch bug permanently
- Display-friendly names derived at runtime from workspace file paths

## Commands

### `link-project <path>` (creates/adds to workspace)

```bash
contextus link-project ~/src/frontend
# → "frontend" added to workspace "my-platform"
# (creates workspace if first link from this project)

contextus link-project ~/src/shared-lib --workspace my-platform
# → explicitly adds to named workspace
```

First link from a project: prompts for workspace name (or auto-generates from
project names). Subsequent links from the same project: adds to existing workspace.

### Workspace Management

```bash
contextus workspace list                    # show all workspaces
contextus workspace show my-platform        # show projects in workspace
contextus workspace create my-platform      # create empty workspace
contextus workspace add <path>              # add project to workspace (from cwd)
contextus workspace remove <path>           # remove project from workspace
contextus workspace delete my-platform      # delete workspace definition
```

### Migration

```bash
contextus migrate-db
# 1. Detects old per-project DBs under ~/.contextus/data/<project>/
# 2. Deletes them
# 3. Re-embeds all known projects into the unified DB
# 4. Converts any linkedProjects config → workspace files
```

Destructive but fast (re-embed is <30s for typical corpora). No users to
worry about currently.

## Reconcile Changes

Reconcile operates on a project partition:
- Receives `project` name from the hook
- Checks `getContentHashes(project)` — scoped to that project's rows
- Embeds/deletes within that partition only
- Other projects' rows untouched

Same logic, just filtered by the `project` column.

## Daemon Changes

- One DB connection (memoized), not per-project
- `resolveDBPath()` returns a fixed path (no project param needed)
- Query endpoint adds workspace resolution before searching
- Reconcile endpoint scopes to the requesting project
- Watcher registration per context dir (unchanged)

## What Goes Away

- `~/.contextus/data/<project>/` directory structure (one dir per project)
- `linkedProjects` config key in tier-2
- `linkedContext` / `linkedContext:<name>` source labels
- `resolveLinkedSources()` / `findMissingLinkedProjects()` / `deleteBySource()`
- Per-project DB connection memoization

## Open Questions

1. **Workspace discovery** — should `/contextus-setup` auto-detect other contextus
   projects in sibling directories and offer to create a workspace? (Nice UX for
   monorepo-adjacent setups.)

2. **Workspace sharing** — workspace files are under `~/.contextus/` (user-local).
   For teams, could a `.contextus-workspace.jsonc` in the repo root declare "I belong
   to workspace X, here are my siblings"? (Git-committable, team-portable.)

3. ~~**Project identity**~~ — **SETTLED**: use `sha256(absolutePath).slice(0, 12)`
   as the project column. Hash is opaque, stable, collision-free for realistic
   project counts. Display names derived from workspace paths at runtime.

4. **Stale project cleanup** — if a project's source directory is deleted, its rows
   persist. Options: reconcile-on-start prunes missing projects, explicit
   `contextus workspace gc`, or leave indefinitely (rows are cheap).

## Implementation Plan

1. Add `project` column to ContextRow + schema
2. Change `resolveDBPath()` to return fixed `~/.contextus/data/` path
3. Update embed pipeline to stamp `project` on every row
4. Update query to accept workspace-scoped project list
5. Implement workspace file read/write
6. Update `link-project` to create/manage workspaces
7. Add workspace management commands
8. Migration script (delete old DBs, re-embed)
9. Remove linked-project-specific code (sources.ts, orphan cleanup)

## Success Criteria

- Same UX as linked projects (one command to connect projects)
- Bidirectional by default (no directionality confusion)
- No duplicate rows (shared-lib embedded once, queryable from all siblings)
- Solo projects work identically to today (no workspace required)
- Migration is painless (re-embed, done)
