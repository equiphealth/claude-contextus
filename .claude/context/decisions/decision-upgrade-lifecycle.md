---
name: upgrade-lifecycle
description: Breaking changes only land via PR with version bump; SessionStart notifies, never auto-migrates; no mid-session surprises
metadata:
  type: decision
  tags: [versioning, upgrade, migration, session-start]
---

**Decision** (2026-06-21): the upgrade lifecycle is notification-driven, never automatic.

## The contract

1. **Breaking changes never commit directly to main** — always via PR with a version bump
2. **SessionStart detects stale data** — compares `~/.contextus/version.json` against `package.json` (~1ms, two file reads)
3. **User migrates at their pace** — notification says "run /contextus-upgrade when ready", never auto-applies
4. **Daemon code updates apply next session** — hooks and daemon re-read from disk on session start, so `git pull` + new session = new code

## Why no auto-migration

- Migrations may re-embed (expensive, minutes)
- User might be mid-flow when session starts
- Failed migration mid-session could leave corpus broken
- "Run when ready" respects user agency

## Why no daemon-version-in-health check

Since breaking changes always land via PR (not live-edited on disk), the "stale daemon running old code" scenario doesn't happen in practice. Users don't `git pull` their plugin source mid-session. Next session → new daemon from new code → upgrade notification fires.

## For contributors

When making a breaking change:
1. Add entry to `migrations/MIGRATIONS.md`
2. Add detection in `scripts/upgrade-detect.ts`
3. Bump `package.json` version (all three manifests in lockstep — see [[versioning]])
4. Land via PR, never direct push to main

The SessionStart hook handles the rest automatically.
