---
name: manage-daemon-skill-bypassed-neutral-dist-resolution
description: >-
  manage-daemon skill hand-rolled a tsx-on-repo-source daemon launch instead of
  delegating to ensureDaemonRunning(), bypassing neutral-dist resolution
  entirely
metadata:
  type: gotcha
  tags:
    - daemon
    - skill
    - neutral-dist
---

**Symptom**: following `/manage-daemon restart`'s documented Start procedure (`nohup node --import tsx daemon/server.ts` from a hardcoded `CONTEXTUS_ROOT=~/src/claude-contextus`) either fails outright or produces a daemon that didn't go through the correct neutral-dist/repo-dist/dev-tsx resolution.

**Root cause**: `scripts/lib/daemon-control.js` already implements the one correct launch mechanism -- `ensureDaemonRunning()` -> `spawnDaemon()` -> `resolveLaunch()` -- which picks neutral dist (`~/.contextus/daemon/dist`) when ready and not in dev mode, falls back to repo dist, then repo tsx only under `CONTEXTUS_DEV=1`. It spawns via Node's own `detached: true` + `unref()`, not a shell `nohup ... & disown`. The `manage-daemon` skill's reference.md never called this -- it hand-rolled a separate, simpler launch command that always ran tsx directly against the repo source, with a hardcoded (and wrong -- `claude-contextus` vs the actual `contextus` checkout name) path and a hardcoded port.

**Confirmed live** (2026-11-01): following the stale skill doc to restart the daemon hit a `sharp` native-binding error in the repo's own `node_modules` (unrelated, separate issue), while the daemon that ended up actually healthy and running was the NEUTRAL dist copy -- started by some other path (a hook's own `ensureDaemonRunning()` call) winning the race, not the documented manual procedure.

**Fix**: `skills/manage-daemon/reference.md` now delegates to `ensureDaemonRunning()` via `node --import tsx -e "import('./scripts/lib/daemon-control.js').then(...)"` instead of reimplementing launch logic, and uses `bash ~/.contextus/scripts/daemon-url.sh` instead of a hardcoded port.

**How to apply**: any skill or doc that needs to start/verify the daemon should call the shared `daemon-control.js` functions (or the installed `daemon-url.sh` helper for just the URL), never hand-roll a parallel launch/port-resolution implementation -- they will drift, and when they do, the hand-rolled one is usually the one that's wrong.
