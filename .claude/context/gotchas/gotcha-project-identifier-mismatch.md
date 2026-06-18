---
name: project-identifier-mismatch
description: Hooks pass absolute paths as project ID but corpus is keyed by basename, causing "No corpus for project" errors
metadata:
  type: gotcha
  tags: [daemon, hooks, corpus, project-id, bug]
---

# Project Identifier Mismatch Gotcha

**Symptom:** Daemon logs show "No corpus for project — skipping" even though the corpus exists in `~/.contextus/data/`.

**Root Cause:** Project identifier inconsistency between:
- **Hooks:** Pass absolute path as `project` (e.g., `"/Users/Anthony.Dawson/src/claude-contextus"`)
- **Corpus keying:** Uses basename (e.g., `"claude-contextus"`)

## How It Manifests

**Daemon log:**
```
INFO No corpus for project — skipping (project=/Users/Anthony.Dawson/src/claude-contextus)
```

**But corpus exists:**
```bash
ls ~/.contextus/data/
# → claude-contextus/  (keyed by basename)
```

**Query fails:**
```bash
curl -s -X POST http://localhost:37800/query \
  -H "Content-Type: application/json" \
  -d '{"project":"/Users/Anthony.Dawson/src/claude-contextus","prompt":"test"}'
# → {"continue": true}  (no injection)
```

**Query succeeds:**
```bash
curl -s -X POST http://localhost:37800/query \
  -H "Content-Type: application/json" \
  -d '{"project":"claude-contextus","prompt":"test"}'
# → {"continue": true, "hookSpecificOutput": {...}}  (injected!)
```

## Why This Happens

**In `lib/config.ts` (`resolveDBPath`):**
```typescript
export function resolveDBPath(projectName?: string): string {
  const { storage } = loadConfig();
  const name = projectName ?? path.basename(process.cwd());
  const p = expandHome(storage.path.replace('{project-name}', name));
  return path.resolve(p);
}
```

When `projectName` is provided, it's used as-is. When omitted, it defaults to `path.basename(process.cwd())`.

**Embedding (scripts/embed-contexts.ts):**
- Runs from project root (`process.cwd() = /Users/Anthony.Dawson/src/claude-contextus`)
- Calls `resolveDBPath()` with no argument
- Gets `path.basename(process.cwd())` = `"claude-contextus"`
- Corpus stored at: `~/.contextus/data/claude-contextus/`

**Hooks (scripts/query-hook.js):**
- Pass `project: process.env.PROJECT_DIR` (absolute path from Claude harness)
- Daemon receives: `"/Users/Anthony.Dawson/src/claude-contextus"`
- Looks for corpus at: `~/.contextus/data//Users/Anthony.Dawson/src/claude-contextus/` (WRONG)

## The Fix

**Hooks should normalize to basename before passing to daemon:**

```javascript
// scripts/query-hook.js (and other hooks)
const project = path.basename(process.env.PROJECT_DIR || process.cwd());

fetch('http://localhost:37800/query', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    project,  // basename, not full path
    prompt,
    cwd: process.env.PROJECT_DIR  // pass full path for config resolution
  })
});
```

**Or daemon should normalize:**

```typescript
// daemon/server.ts, handleQuery()
const project = typeof body.project === 'string' && body.project
  ? path.basename(body.project)
  : undefined;
```

## Workaround (Until Fixed)

**Option 1:** Manually pass basename in test scripts:
```bash
curl -X POST http://localhost:37800/query \
  -d '{"project":"claude-contextus","prompt":"test"}'
```

**Option 2:** Re-embed corpus with full path:
```bash
cd /Users/Anthony.Dawson/src/claude-contextus
PROJECT=/Users/Anthony.Dawson/src/claude-contextus pnpm embed
# (would need to modify embed script to accept PROJECT env var)
```

**Option 3:** Symlink the corpus (hack):
```bash
ln -s ~/.contextus/data/claude-contextus \
  ~/.contextus/data/Users-Anthony-Dawson-src-claude-contextus
```

## Detection

**Check if corpus exists for a project:**
```bash
curl -s "http://localhost:37800/introspect?project=/path/to/project" | jq .corpus.chunks
# → 0 (no corpus)

curl -s "http://localhost:37800/introspect?project=basename" | jq .corpus.chunks
# → 1207 (corpus exists!)
```

## Impact

- **Hooks always fail** — No context injection in production use
- **Test scripts fail** — Unless they manually use basename
- **Silent degradation** — Daemon returns `{"continue": true}`, Claude proceeds without context
- **Confusing logs** — "No corpus for project" when corpus clearly exists

## Related Issues

- **Multi-project workspaces:** Two repos with same basename (e.g., `api/` in different repos) would collide
- **Case sensitivity:** macOS is case-insensitive, Linux isn't — `MyProject` vs `myproject` could mismatch

## Status

**UNFIXED** as of 2026-06-18. Discovered via dogfooding the test-api.sh script.

## Code Locations

- `lib/config.ts` — `resolveDBPath()` logic (line 561)
- `scripts/query-hook.js` — Passes `PROJECT_DIR` as-is
- `daemon/server.ts` — Receives project parameter, doesn't normalize
- `scripts/embed-contexts.ts` — Uses basename by default
