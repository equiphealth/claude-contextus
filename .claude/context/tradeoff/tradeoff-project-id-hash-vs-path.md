---
name: project-id-hash-vs-path
description: ProjectId uses SHA256 hash for stability but sacrifices debuggability - operators can't identify projects from logs/directories
metadata:
  type: tradeoff
  tags: [project-id, debugging, ux]
---

# Problem

ProjectId is a 12-char SHA256 hash of the absolute path (e.g., `09536d40613e`). This makes debugging painful:
- Logs show hashes, not project names
- Directory names like `~/.contextus/data/09536d40613e/` are opaque
- Orphaned directories (not in registry) can't be identified without reverse engineering
- Operators wish they "just used the project path instead of the damn hash"

## Why We Use Hashes

**Stability across renames/moves**: If projectId was the path string, moving a project would orphan its entire corpus. The hash creates a stable identifier independent of filesystem location.

**No name collisions**: Multiple projects named "automation" or "app" would conflict if we used basename. Hashes guarantee uniqueness.

**Cross-machine portability**: Same absolute path on different machines = same hash = same projectId (matters for shared workspaces).

## Costs

**Debuggability suffers**:
- `usage-ratings.jsonl` lives in a hash directory - can't tell which project without checking `projects.json`
- Daemon logs show `projectId: 8fa4d8ac62c3` - no human-readable context
- Orphaned directories (tests, deleted projects) are unidentifiable

**Registry is single point of truth**: If `projects.json` is corrupted or out of sync, hash directories become archaeological mysteries.

## Alternatives Considered

1. **Use project name as ID** - Fails on collisions (multiple "app" projects)
2. **Use path as ID** - Breaks on renames/moves (corpus orphaned)
3. **Hybrid: hash + name symlink** - `data/8fa4d8/` with `data/claude-contextus@ -> 8fa4d8/` symlink. Adds complexity, fragile on Windows.
4. **Embed project path in every row** - Wastes tokens (repeated in every LanceDB row), query filtering still needs hash

## What We Should Do

**Phase 2 analytics should use human-readable names everywhere**:
- `/context-status` should say "claude-contextus" not "8fa4d8ac62c3"
- Logs should include `project: automation (e70f0dcf1fbd)` not just the hash
- CLI tools should accept name/path and resolve to hash internally

**Orphan cleanup**: Add `/context-doctor` check for directories in `~/.contextus/data/` not in registry, offer to delete them.

**Registry as source of truth**: The `projects.json` lookup from hash → {path, name} is load-bearing. Introspect endpoint already includes it (`/introspect?project=<hash>` returns `{projectName}`). Use it.

## Current State

- ✅ Hash provides stability
- ✅ Registry maps hash → name/path
- ❌ Logs/directories show only hash (poor DX)
- ❌ Orphaned directories unidentifiable
- ❌ CLI tools require manual hash lookup

**This is a "we got the data model right but the UX wrong" tradeoff**. The hash choice is sound; we just need better UI layers on top of it.
