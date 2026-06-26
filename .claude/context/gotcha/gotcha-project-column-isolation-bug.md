---
name: gotcha-project-column-isolation-bug
description: "[FIXED] Unified DB WHERE project IN filter not working — queries return rows from other projects instead of project-scoped results"
metadata:
  type: gotcha
  tags: [unified-db, project-isolation, lance-client, resolved]
---

# Project Column Isolation Bug: WHERE Clause Not Filtering

**STATUS: FIXED** (2026-06-25) — `corpusStats()` now filters by project at line 71-73 in `lib/introspect.ts`.

## Problem

The unified LanceDB implementation has a critical isolation bug: **the `WHERE project IN (self + workspace)` filter is not being applied correctly**.

**Symptom:**
- Query `/introspect?project=automation-hash` returns 914 chunks
- But `/reconcile?project=automation-hash&check=true` says corpus is empty
- The chunks being returned have projectIds from OTHER projects (e.g., `8fa4d8ac62c3:gotcha-skill-project-scoping.md` in automation project)

**Impact:**
- Dashboard stats show inflated numbers (includes other projects' context)
- Reconciliation doesn't see files that already exist
- Cross-project context leaks into query results
- Project isolation is broken

## Root Cause — FOUND

**The problem is in `introspect.ts` → `corpusStats()` doesn't filter by projectId.**

- `search()` in `lance-client.ts` **correctly** applies `WHERE project IN (scope)` filter (line 194)
- `getContentHashes()` **correctly** applies `WHERE project = '...'` filter (line 288)
- `corpusStats()` **does NOT** — it queries all rows with no project filtering (line 70)

**Broken code** in `lib/introspect.ts` line 70:
```typescript
const rows = (await table.query()
  .select(['id', 'type', 'hit_count'])
  .toArray()) as Array<...>
```

This reads **ALL rows from ALL projects** in the unified DB.

**Fix needed:**
```typescript
const projectFilter = project ? `project = '${project.replace(/'/g, "''")}'` : undefined;
let q = table.query().select(['id', 'type', 'hit_count']);
if (projectFilter) q = q.where(projectFilter);
const rows = (await q.toArray()) as Array<...>
```

**Side effect:** `reconcile` endpoint works correctly (uses `getContentHashes` which filters), but `/introspect` leaks rows, so `/context-status` shows wrong stats.

## How It Should Work

**Current (broken):**
```typescript
const rows = await table.query().select(...).toArray()
// Returns ALL rows from all projects in the unified DB
```

**Should be (fixed):**
```typescript
const rows = await table.query()
  .where(`project IN ('${projectId}', ...)`)  // Workspace siblings too
  .select(...)
  .toArray()
```

## Verification

From automation project:
```bash
projectId=e6be1de2bbd6

# This shows 914 chunks (WRONG — should be 0 or actual automation context)
curl -s "http://127.0.0.1:37800/introspect?project=${projectId}" | jq '.corpus.chunks'

# This correctly identifies corpus as empty (RIGHT)
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${projectId}\",\"cwd\":\"$(pwd)\",\"check\":true}" | jq '.state'
# => "empty"

# But the top result shows contextus projectId (WRONG isolation)
curl -s "http://127.0.0.1:37800/introspect?project=${projectId}" | jq '.corpus.topHits[0].id'
# => "8fa4d8ac62c3:gotcha-skill-project-scoping.md#8"
```

The query is returning rows with a different projectId, proving the WHERE clause is not filtering.

## Fix Approach

1. **Locate filtering code** in `lib/storage/lance-client.ts`
2. **Verify WHERE clause is applied** to all query operations
3. **Include workspace siblings** if the project is in a workspace
4. **Test per-project isolation** after fix
5. **Update reconcile** to use the same scoping (so it sees its own files)

## Related

- `decision/decision-unified-db-workspaces.md` — Design specifies workspace + projectId filtering
- `gotcha/gotcha-skill-project-scoping.md` — Skill-level scoping is correct, but daemon-level filtering is broken
- Unified DB is new (June 2026) so this may be incomplete implementation

## Timeline

**Discovered:** 2026-06-24 during skill fix validation  
**Severity:** CRITICAL — Core project isolation is broken
