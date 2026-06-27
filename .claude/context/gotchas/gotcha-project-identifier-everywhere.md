---
name: project-identifier-everywhere
description: All daemon endpoints must normalize project identifiers (name/hash/path) to canonical hash before DB operations
metadata:
  type: gotcha
  tags: ["daemon", "project-scoping", "bugs"]
---

# Project Identifier Normalization

The daemon accepts project identifiers in three forms:
- **Friendly name** ("automation")
- **SHA256 hash** ("e70f0dcf1fbd")
- **Full path** ("/Users/me/src/my-project")

But LanceDB stores rows with `project` field set to the **canonical 12-char hash only**.

## The Bug

If any daemon endpoint receives a project identifier and passes it directly to DB operations (search, tableExists, loadCorpusForKeyword, etc.) without normalizing, queries will fail silently:
- Search returns empty results (WHERE project = 'automation' matches nothing)
- tableExists returns false (no table named "automation")
- Reconcile creates duplicate rows under wrong project ID

## The Fix

Every endpoint handler must:
1. Call `resolveProjectId(project)` to normalize name/hash/path → canonical hash
2. Use the normalized `projectId` for ALL DB operations
3. Keep the raw `project` as `projectLabel` for human-readable logging only

## Where to Normalize

All handlers that accept a project parameter:
- `handleQuery` (GET /query)
- `handleReconcile` (POST /reconcile)
- `handleCapture` (POST /capture)
- `/introspect` (GET /introspect)
- Any new endpoints that query the corpus

## Registry Dependency

`resolveProjectId()` uses the registry at `~/.contextus/data/projects.json` to resolve names → paths → hashes. If a project isn't registered yet, name resolution falls back to treating the input as a hash. This means the first session in a project MUST pass the full path (so `projectHash(cwd)` works), and subsequent sessions can use the friendly name.

## Testing Tip

To verify normalization works:
```bash
# Embed a corpus from a project
cd ~/src/my-project && tsx ~/src/contextus/scripts/embed-contexts.ts

# Search by name (should work after normalization fix)
tsx ~/src/contextus/scripts/cli/context-search.ts "query" --project my-project

# Search by hash (should return same results)
HASH=$(echo -n ~/src/my-project | sha256sum | cut -c1-12)
tsx ~/src/contextus/scripts/cli/context-search.ts "query" --project $HASH

# Both should return identical results if normalization is correct
```
