---
name: daemon-restart-on-upgrade
description: Daemon must be killed before upgrades — holds memoized DB connections and old code paths that don't hot-reload
metadata:
  type: gotcha
  tags: [daemon, upgrade, lifecycle]
---

# Daemon Restart Required on Code Upgrades

Config hot-reloads (retrieval thresholds, expansion settings, etc.) but **code changes do not**. The daemon process must be killed before any upgrade that changes:

- DB path logic (`resolveDBPath()`)
- Query scoping (workspace resolution, `WHERE project IN (...)`)
- LanceDB connection setup (memoized `_conn` in lance-client)
- Row schema (new columns, ID format changes)
- Watcher behavior (event handling, embed logic)

## Why it's dangerous

The daemon survives across sessions (respawns via SessionStart hook). After `git pull` brings new code, the running daemon is still executing the *old* code. Symptoms:

- Queries hit old DB path (returns empty)
- New workspace scoping doesn't apply (cross-project leakage)
- Memoized connection points to stale/deleted LanceDB

## What to do

The `/contextus-upgrade` skill includes a "Stop daemon" step before migrations. For manual upgrades:

```bash
kill $(cat ~/.contextus/runtime/daemon.pid) 2>/dev/null
# Respawns automatically on next session start
```

## Distinction from config hot-reload

| What changed | Restart needed? |
|---|---|
| `.claude/contextus.jsonc` values | No — re-read every request |
| `plugin.jsonc` values | No — re-read every request |
| TypeScript source code | **Yes** — daemon runs old process |
| Embedding provider | **Yes** — model must re-warm |
| DB schema/layout | **Yes** — memoized connection is stale |

## Related

- `implementation/implementation-config-hot-reload.md` — what DOESN'T need restart
- `gotcha-embedding-provider-switch.md` — specific case (provider change)
