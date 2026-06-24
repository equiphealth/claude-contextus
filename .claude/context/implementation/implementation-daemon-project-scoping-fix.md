---
name: implementation-daemon-project-scoping-fix
description: Fix daemon project scoping — pass projectId to all endpoints, daemon looks up workspace scope from projectId alone
metadata:
  type: implementation
  tags: [daemon-api, unified-db, project-isolation]
---

# Daemon Project Scoping Fix

## Problem

The daemon is trying to use `cwd` to compute workspace scope, but `cwd` in the daemon is always the contextus directory (where the daemon runs). This breaks `resolveProjectScope(cwd)` because it's not the actual project's path.

## Solution: Project-Driven Lookup

**New architecture:**
1. All HTTP callers pass `project` (the projectId hash)
2. Daemon accepts ONLY `project` parameter (no cwd needed for scoping)
3. Daemon looks up workspace membership using projectId as the key
4. Everything else (config, workspace scope, corpus) is looked up from projectId

**Why this works:**
- projectId is deterministic (sha256 of the actual project path on disk)
- Workspace files can be looked up by projectId (not filesystem path)
- Daemon doesn't need to know WHERE a project is, just WHO it is
- One source of truth: `~/.contextus/workspaces/` or a workspace index

## Changes Required

### 1. `/query` endpoint
**Current:** Accepts optional `cwd` + `project`  
**New:** Accept only `project` (required)

```typescript
const project = body.project as string; // REQUIRED
if (!project) return sendJson(res, 400, { error: 'project required' });

// Look up scope from projectId alone
const projectScope = resolveProjectScopeByProjectId(project);
```

### 2. `/introspect` endpoint
**Current:** Accepts `?project=<id>` query param  
**New:** Same, but use it for lookups

```typescript
const project = params.get('project') as string; // REQUIRED
// corpusStats now filters by project
const stats = await corpusStats(project);
```

### 3. `/reconcile` endpoint
**Current:** Accepts `cwd` (used to compute projectId)  
**New:** Accept only `project` (projectId hash)

```typescript
const project = body.project as string; // REQUIRED
// No need to use cwd at all
const projectId = project;
```

### 4. New helper: `resolveProjectScopeByProjectId(projectId: string)`

Look up workspace membership without needing filesystem paths:

```typescript
export async function resolveProjectScopeByProjectId(projectId: string): Promise<string[]> {
  // Read ~/.contextus/workspaces/
  const scope = [projectId, '__user__']; // Start with self + user context
  
  // Load workspace definitions and find this projectId's siblings
  // e.g., if projectId is in "engineering.jsonc", add all projects in that workspace
  const workspaces = await loadWorkspaceDefinitions();
  for (const ws of workspaces) {
    if (ws.projects.some(p => projectHash(p) === projectId)) {
      // This project is in a workspace — add siblings
      scope.push(...ws.projects.map(p => projectHash(p)));
      break;
    }
  }
  
  return Array.from(new Set(scope)); // Dedupe
}
```

### 5. `corpusStats()` fix (critical)

Currently doesn't filter by project. Add projectId parameter:

```typescript
export async function corpusStats(project?: string): Promise<CorpusStats> {
  if (!(await tableExists(project))) return empty;
  const table = await openTable(project);
  
  let query = table.query().select(['id', 'type', 'hit_count']);
  
  // ADD: Filter by projectId
  if (project) {
    query = query.where(`project = '${project.replace(/'/g, "''")}'`);
  }
  
  const rows = await query.toArray();
  // ... rest of function
}
```

## Caller Changes

### UserPromptSubmit hook
**Before:** Computes projectId, passes it
**After:** Same (already correct)

```bash
projectId=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -X POST http://127.0.0.1:37800/query \
  -d "{\"project\":\"${projectId}\",\"prompt\":\"...\"}"
```

### Session-start hook (reconcile)
**Before:** Passes `cwd` + optional `project`
**After:** Compute projectId, pass it only

```bash
projectId=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -X POST http://127.0.0.1:37800/reconcile \
  -d "{\"project\":\"${projectId}\"}"
```

### Skills
**Already fixed** (pass projectId) — no change needed

## Why This Is Better

1. **Stateless daemon** — doesn't need to know filesystem paths
2. **No cwd confusion** — daemon only sees projectId hashes
3. **Workspace lookup is centralized** — can be cached, validated
4. **HTTP API is simpler** — no cwd parameter required
5. **Portable** — projectId is the same regardless of where the project is cloned

## Related

- `gotcha/gotcha-project-column-isolation-bug.md` — Root cause: corpusStats doesn't filter
- `gotcha/gotcha-skill-project-scoping.md` — Skills side is correct
- `decision/decision-unified-db-workspaces.md` — Workspace architecture
