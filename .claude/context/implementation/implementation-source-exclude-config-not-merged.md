---
name: source-exclude-config-not-merged
description: "FIXED 2026-07-20: sources.*.exclude patterns now properly merge from project config (was: resolveSources used raw plugin.json)"
metadata:
  type: implementation
  tags: ["config", "sources", "embedding", "fixed"]
---

# Implementation: Source Exclude Config Merge (Fixed)

**Status**: Fixed on 2026-07-20
**Issue**: `.claude/contextus.json` overrides to `sources.projectDocs.exclude` were ignored

## What Was Broken

`scripts/embed-contexts.ts` called `resolveSources(pluginCfg)` where `pluginCfg = findPluginConfig()` — this returned ONLY `plugin.json` config, NOT the 3-tier merged config.

```typescript
// BEFORE (broken)
const pluginCfg = findPluginConfig();  // Raw plugin.json only
const cfg = loadProjectConfig(...);    // Merged config
const sources = resolveSources(pluginCfg);  // ❌ Wrong input
```

## The Fix

1. Added `SourcesConfig` interface to `ContextusConfig`
2. Added sources to DEFAULTS with plugin.json values
3. Added sources merging to `mergeConfigInto()`:
   ```typescript
   if (c.sources) {
     for (const [key, sourceOverride] of Object.entries(c.sources)) {
       if (!merged.sources[key]) {
         merged.sources[key] = sourceOverride as SourceConfig;
       } else {
         Object.assign(merged.sources[key], sourceOverride);
       }
     }
   }
   ```
4. Changed `resolveSources` signature from `(pluginConfig: Record<string, unknown>)` to `(sources: Record<string, RawSource>)`
5. Updated `embed-contexts.ts`:
   ```typescript
   // AFTER (fixed)
   const cfg = loadProjectConfig(projectId, process.cwd());
   const sources = resolveSources(cfg.sources);  // ✅ Merged config
   ```

## Files Changed

- `lib/config.ts`: Added SourcesConfig interface, DEFAULTS, and merge logic
- `lib/embedding/sources.ts`: Changed resolveSources signature
- `scripts/embed-contexts.ts`: Removed findPluginConfig import, use cfg.sources

## Verification

Tested in automation project:
```json
// .claude/contextus.json
{
  "sources": {
    "projectDocs": {
      "exclude": ["prompts/**"]
    }
  }
}
```

Before: docs/prompts/** files embedded (391 chunks including prompts)
After: docs/prompts/** excluded (391 chunks, no prompts in results)

## Why This Matters

Project-level source customization is documented but was silently failing. Users expect `.claude/contextus.json` overrides to work for sources just like they do for `retrieval`, `expansion`, etc.
