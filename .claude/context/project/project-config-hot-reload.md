---
name: config-hot-reload
description: Config is re-read on every /query — no daemon restart needed for config changes
scope: project
category: project
tags: [daemon, config, operations]
---

# Config is Hot-Reloaded (No Daemon Restart)

`loadProjectConfig()` runs on every `/query` request — the daemon does NOT cache config at startup. Edit `.claude/contextus.json` (or plugin.json) and the next prompt picks up changes immediately.

This applies to all runtime config: expansion settings, retrieval thresholds, provider selection, logging toggles, etc.

The only change that requires a restart is the daemon's own listen port/socket path (since the HTTP server binds once at startup).
