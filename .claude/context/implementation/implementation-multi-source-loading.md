---
name: multi-source-loading
description: Complete multi-source embedding - daemon needs to iterate over all enabled sources from config
metadata:
  type: implementation
  tags: [sources, embedding, user-context, incomplete-feature]
---

# Problem

User-scoped sources (`userContext`, `userDocs`) are defined in `plugin.jsonc` and marked `enabled: true`, but they never get embedded. The daemon only processes project-scoped sources.

**Evidence:**
- `introspect?project=X` returns `"packs": ["projectContext"]` (should include userContext, projectDocs, userDocs)
- Files in `~/.contextus/context/` never appear in search results
- Rerank weights exist for `userContext` (0.8) but that source is never loaded

## Root Cause

`daemon/server.ts` line ~849 hardcodes a single `runReconcile()` call for `.claude/context/`:
```typescript
runReconcile(contextDir, project, projectId)
```

It should iterate over all enabled sources from `plugin.jsonc` config.

## What's Already Fixed

`lib/embedding/reconcile-run.ts` now accepts a `source` parameter (defaulting to 'projectContext'):
```typescript
export async function runReconcile(
  contextDir: string,
  projectName?: string,
  projectId = '',
  source = 'projectContext'  // ✓ Now parameterized
): Promise<ReconcileResult>
```

The hardcoded `'projectContext'` strings in buildRows/embedSingleFile/getContentHashes calls have been replaced with the `source` parameter.

## Status: FIXED (2026-06-25)

The daemon now iterates over all enabled sources from config instead of hardcoding two. Changes made:

1. **Reconcile endpoint** (`daemon/server.ts` line ~883): Now reads `cfg.sources`, filters enabled sources, and calls `runReconcile()` for each with correct scope handling
2. **Notify endpoint** (`daemon/server.ts` line ~510): Added `determineSource()` helper to identify which source a file belongs to based on path matching
3. **File watching**: Now watches all enabled source directories after reconcile completes
4. **Introspection bug fixed** (`lib/config.ts` line 566): `loadedSourceNames()` now strips JSONC comments before parsing (was silently failing and returning [])

All four sources (`projectContext`, `projectDocs`, `userContext`, `userDocs`) now embed when enabled.

**Verified working:**
- `/introspect?project=X` returns all 4 sources in `packs` array
- Corpus size increased from 547 → 1,319 chunks (includes user and docs sources)
- User-scoped patterns in `~/.contextus/context/` are retrievable across projects

## Implementation Details

### Reconcile Loop (daemon/server.ts ~883-911)
```typescript
const cfg = findPluginConfig();
const sources = cfg.sources as Record<string, {
  scope: 'project' | 'user';
  path: string;
  enabled?: boolean;
}>;

const reconcileTasks = Object.entries(sources)
  .filter(([, s]) => s.enabled !== false)
  .map(([sourceName, s]) => {
    const sourcePath = s.scope === 'project'
      ? path.join(cwd, s.path)
      : expandHome(s.path);
    const pid = s.scope === 'project' ? projectId : '';
    const proj = s.scope === 'project' ? project : undefined;
    return { sourceName, sourcePath, pid, proj, scope: s.scope };
  });

const results = await Promise.all(
  reconcileTasks.map(t => runReconcile(t.sourcePath, t.proj, t.pid, t.sourceName))
);
```

### Source Detection (daemon/server.ts ~481-508)
```typescript
function determineSource(
  absFile: string,
  cwd: string,
  project: string | undefined
): { sourceName: string; sourceDir: string; projectId: string; project: string | undefined } | null {
  const cfg = findPluginConfig();
  const sources = cfg.sources as Record<string, { scope: 'project' | 'user'; path: string; enabled?: boolean }>;
  
  for (const [sourceName, s] of Object.entries(sources)) {
    if (s.enabled === false) continue;
    const sourceDir = s.scope === 'project' ? path.join(cwd, s.path) : expandHome(s.path);
    if (absFile.startsWith(sourceDir + path.sep) || absFile === sourceDir) {
      const pid = s.scope === 'project' ? (project ?? projectHash(cwd)) : '';
      const proj = s.scope === 'project' ? project : undefined;
      return { sourceName, sourceDir, projectId: pid, project: proj };
    }
  }
  return null;
}
```

The `/notify` endpoint uses this to route incremental embeds to the correct source.

## Source Naming

Source names in `plugin.jsonc` now match the `source` column values exactly (fixed 2026-06-25):
- `projectContext` (was `projectMemory` - stale naming from old memory system)
- `projectDocs`
- `userContext`
- `userDocs`

No mapping needed - the config key goes directly into the `source` column.

## Key Implementation Details

**Project vs User scope:**
- **Project-scoped** sources (`scope: "project"`) need:
  - `projectId` (hash) stamped on rows
  - `projectName` for table scoping
  - Paths resolved relative to `cwd`

- **User-scoped** sources (`scope: "user"`) need:
  - Empty `projectId` (global corpus)
  - `undefined` projectName
  - Paths resolved with `expandHome()` for `~`

**File watching:**
After reconcile completes, watch ALL source directories for live updates:
```typescript
sources.forEach(([sourceName, s]) => {
  watchContextDir(resolvedPath, proj, sourceName, pid);
});
```

## Related Code

- `lib/config.ts` exports `findPluginConfig()` - returns raw plugin.json config object
- `lib/config.ts` exports `expandHome(path)` - handles `~/` expansion
- `lib/config.ts` exports `loadedSourceNames()` - returns enabled source names (used by introspect)
- `daemon/server.ts` line ~846 - handleReconcile() needs the fix
- `daemon/server.ts` line ~860 - watchContextDir() calls also need iteration

## Verification

After implementing, verify with:
```bash
# Trigger reconcile
curl -X POST 'http://127.0.0.1:37800/reconcile' \
  -H 'Content-Type: application/json' \
  -d '{"project":"test","cwd":"/path/to/project"}'

# Check loaded packs
curl -s 'http://127.0.0.1:37800/introspect?project=<hash>' | jq '.packs'
# Should return: ["projectContext", "userContext", "projectDocs", "userDocs"]

# Check corpus has multiple sources
curl -s 'http://127.0.0.1:37800/introspect?project=<hash>' | jq '.corpus.chunks'
# Should be higher than before (includes user sources)
```
