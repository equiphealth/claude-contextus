---
name: hook-js-ts-duplication
description: Hooks use plain JS (no build step) while core uses TS, requiring duplicate port discovery logic
metadata:
  type: gotcha
  tags: ["hooks", "packaging", "typescript", "maintenance"]
---

# Hook JS/TS Duplication

**Problem**: Hooks must be plain JavaScript (no build step) but core logic is TypeScript, leading to code duplication and sync bugs.

## Why Hooks Are Plain JS

Hooks run as `node scripts/query-hook.js` on every prompt. We cannot use TypeScript directly because:

1. **tsx overhead**: Running via `tsx` adds ~100-200ms per invocation, which is noticeable for high-frequency hooks like UserPromptSubmit
2. **No dist/ build yet**: Plugin installs from source, not from compiled artifacts
3. **Zero-config goal**: Hooks should work immediately after `git clone` or plugin install

## Current Duplication

- **lib/daemon-url.ts**: Canonical TypeScript implementation (used by CLI scripts, skills)
- **scripts/lib/daemon-control.js**: Plain JS duplicate (used by hooks)

Both implement the same 3-tier port discovery:
1. CONTEXTUS_DAEMON_URL env var
2. ~/.contextus/runtime/daemon.port file
3. CONTEXTUS_DAEMON_PORT env var or 37800 default

They must stay in sync manually — daemon-control.js has a comment noting this.

## Example Breakage

When refactoring `BASE_URL` constant → `getBaseURL()` function for caching, we updated:
- ✓ lib/daemon-url.ts (TypeScript)
- ✓ scripts/mine-transcripts.ts (imports from daemon-url.ts)
- ✓ scripts/lib/daemon-control.js (JS implementation)
- ✗ **Forgot hooks** — they import from daemon-control.js, broke at runtime

## The Proper Fix (v1.1 Packaging)

Build everything to `dist/` at install/upgrade time:

```bash
# SessionStart or install script
if [ ! -d dist/ ] || [ daemon/server.ts -nt dist/daemon/server.js ]; then
  npx tsc --build
fi
```

Then:
- hooks.json references compiled JS: `"command": "node", "args": ["$PLUGIN_PATH/dist/scripts/query-hook.js"]`
- Hooks can import from compiled lib/daemon-url.js
- No more duplication, no more sync bugs
- Dev mode still uses tsx (detected via tsconfig.json presence)

## Workarounds Until Then

1. **Check both files** when refactoring shared logic (port discovery, project hashing)
2. **Test hooks after changes** — run a prompt and check for hook errors
3. **Grep for imports** — when changing daemon-control.js exports, grep for all imports

## Related

- docs/dev/PACKAGING.md — v1.1 packaging work
- memory: next-v1-1-packaging.md — Docs & DX gate DONE, packaging work is next
- scripts/lib/daemon-control.js — JS implementation with sync comment
- lib/daemon-url.ts — TypeScript canonical implementation

## Trade-off

**Why not just use tsx for hooks?**

UserPromptSubmit fires on every user message. Even 100ms overhead per prompt is noticeable:
- 10 prompts = 1 second of pure tsx startup overhead
- Multiplied by every contextus user, every session
- For a task (import resolution) that compiled JS does in ~5ms

Once we ship dist/, hooks run as fast compiled JS and we delete the duplicate.
