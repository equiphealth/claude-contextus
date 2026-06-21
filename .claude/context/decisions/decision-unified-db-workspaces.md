---
name: decision-unified-db-workspaces
description: Single shared LanceDB with project-hash column replaces per-project DBs; workspaces enable bidirectional cross-project context sharing
metadata:
  type: decision
  tags: [architecture, storage, workspaces, linked-projects]
---

# Unified DB + Workspaces

## Decision

Replace per-project isolated databases (`~/.contextus/data/<project>/`) with a
single shared LanceDB at `~/.contextus/data/contextus.lance`. Projects are
identified by `sha256(absolutePath).slice(0, 12)` — opaque, stable, collision-free.

Cross-project context sharing uses **workspaces** (bidirectional groups) instead
of directed links. A workspace file lists projects that share context symmetrically.

## Why

- Per-project DBs duplicate rows when projects link to each other (N linked
  projects = N copies of shared patterns)
- Directed linking (A→B) doesn't match the mental model — "these projects are
  related" is inherently symmetric
- Basename as project identifier causes collisions and the
  hooks-vs-embed mismatch bug
- Single DB = one connection, one reconcile path, no orphan-cleanup complexity

## Key Design Points

- **Project column**: `sha256(absolutePath).slice(0, 12)` — not basename, not
  full path. Both hooks and embed compute the same hash from the same input.
- **Workspace files**: `~/.contextus/workspaces/<name>.jsonc` — one per group,
  lists member project paths. Human-readable, one file per workspace.
- **Query scoping**: `WHERE project IN (self + workspace siblings)`. Projects
  not in any workspace only see their own rows.
- **Proximity weighting**: own project = 1.0 (projectContext), siblings = 0.85
  (siblingWeight, configurable per-project in `.claude/contextus.jsonc`).
  Weight is relative to *where you query from*, not a workspace property.
- **Personal context** (`~/.claude/memory`, `~/.claude/docs`): always included
  regardless of workspace membership, stored with sentinel project value.
- **`link-project`** command: creates/adds to a workspace (ergonomic entry point).
  Separate `workspace` subcommands for management.

## How to Apply

- All storage code should use the hash-based project identifier, never basename
- New features that touch project identity should reference UNIFIED_DB_DESIGN.md
- The `linkedContext` source type and per-link source labels (`linkedContext:<name>`)
  will be removed when this ships — don't build on them
- `resolveDBPath()` will return a fixed path (no project param)
- Design doc: `docs/dev/UNIFIED_DB_DESIGN.md`
