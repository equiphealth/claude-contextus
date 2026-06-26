---
name: loadedSourceNames-jsonc-parse
description: loadedSourceNames() failed to parse plugin.jsonc comments, causing introspect to show empty packs array
metadata:
  type: gotcha
  tags: [jsonc, parsing, introspection, sources]
---

# Problem

After implementing multi-source loading in the daemon, `introspect?project=X` still returned:
```json
{
  "packs": ["projectContext"]
}
```

Even though reconcile was iterating all four sources and embedding them correctly.

## Root Cause

The `loadedSourceNames()` function (used by introspection) was parsing `plugin.jsonc` **without stripping comments**:

```typescript
// lib/config.ts line 566 (BEFORE FIX)
const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
```

This threw a parse error on the first `//` comment, which was caught by the outer `try/catch` and silently returned `[]`.

Meanwhile, `findPluginConfig()` (used by the daemon) correctly called `stripJsonComments()` before parsing, so it loaded all sources fine.

## Symptoms

- `introspect` shows `"packs": []` or `"packs": ["projectContext"]` (stale default)
- Daemon logs show successful reconcile for all four sources
- Corpus size increases correctly (includes all sources)
- `/context-status` skill shows wrong source count

The discrepancy is invisible unless you check introspect output directly.

## Fix

```typescript
// lib/config.ts line 566 (AFTER FIX)
const text = fs.readFileSync(pluginPath, 'utf-8');
const raw = JSON.parse(stripJsonComments(text));
```

Always use `stripJsonComments()` before `JSON.parse()` when reading `.jsonc` files.

## How to Detect

```bash
curl -s 'http://127.0.0.1:37800/introspect?project=<hash>' | jq '.packs'
# Should return: ["projectContext", "projectDocs", "userContext", "userDocs"]
# Was returning: [] or just ["projectContext"]
```

## Related

- `lib/config.ts` line 562: `loadedSourceNames()` function
- `lib/config.ts` line 119: `stripJsonComments()` utility
- `lib/introspect.ts`: uses `loadedSourceNames()` for the `packs` field
- Fixed alongside multi-source loading implementation (2026-06-25)
