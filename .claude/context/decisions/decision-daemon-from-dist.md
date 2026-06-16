---
name: daemon-from-dist
description: The daemon runs from compiled dist/ (node dist/daemon/server.js), not tsx; dist/ is committed; tsx is a dev-only fallback
metadata:
  type: decision
  tags:
    - packaging
    - daemon
    - build
    - distribution
---

**Decision** (2026-06-15): drop the runtime `tsx` requirement — the daemon runs as
**`node dist/daemon/server.js`**.

- `tsconfig` includes `daemon/**`, so `tsc` emits `dist/daemon/{server,eval-worker}.js`.
- **`dist/` is committed** (runtime `.js` only; `.d.ts`/`.map` stay gitignored) so a
  marketplace clone runs with no build step. Guarded by `npm run verify:dist` + a CI
  freshness gate (a rebuild must produce no diff).
- `daemon-control.js` `resolveLaunch()` prefers the compiled JS; running via `tsx` on
  the `.ts` source is now a **dev-only fallback** (when `dist/` is absent).

**Landmine fixed in the process:** `findPluginJson()` resolved `..`-from-`lib/`, which
returned null when run as `dist/lib/config.js` (→ `..` is `dist/`), silently falling
back to DEFAULTS (`provider: transformers`, HF-blocked) instead of the configured
`ollama`. Now honors `$CLAUDE_PLUGIN_ROOT` then walks up. This would have shipped a
broken default to every install. See `docs/dev/PACKAGING.md`.
