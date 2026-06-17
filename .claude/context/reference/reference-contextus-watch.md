---
name: contextus-watch-modes
description: How to use contextus watch — all modes, flags, and what each log file contains
metadata:
  type: reference
  tags: [watch, logging, debugging, paranoid]
---

# Contextus Watch Modes

Live activity follower over daemon logs. Three log sources, each with different granularity.

## Default (daemon.log)

```bash
contextus watch                     # all projects
contextus watch -p automation       # one project
contextus watch -v                  # verbose (floor-dropped scores)
contextus watch --since 1h          # replay last hour then follow
contextus watch --since 30m --no-follow  # replay only
```

Shows: retrievals (count + latency), no-injects (best score), embeds, errors, calibration evals. Human-readable single-line events.

## JSON (usage.jsonl)

```bash
contextus watch --json              # raw JSONL
contextus watch --json | jq .       # pretty-print
```

Machine-readable events: full similarity scores, token counts, floor-dropped patterns, prompt hashes. For analytics and piping.

## Paranoid (paranoid.jsonl)

```bash
contextus watch --paranoid          # formatted cards
contextus watch --paranoid -v       # full injection text (not truncated)
```

**Requires `logging.paranoid: true` in config.** Logs the complete round-trip:
- Full user prompt text
- Complete injection payload (everything prepended to Claude's context)
- All similarity scores and retrieved pattern names

Enable in `.claude/contextus.json`:
```json
{ "logging": { "paranoid": true } }
```

Or in `plugin.json` config block for global use.

**After changing config**: restart the daemon (it caches config on first load). Kill the PID in `~/.contextus/runtime/daemon.pid` and let SessionStart respawn it.

## Log file locations

```
~/.contextus/logs/
├── daemon.log       ← default watch target
├── usage.jsonl      ← --json target
├── paranoid.jsonl   ← --paranoid target (opt-in)
└── errors.jsonl     ← structured errors only
```

## Common debugging workflow

1. `contextus watch --paranoid -v` in one terminal
2. Ask a question in Claude
3. See exactly what prompt went in and what context came out
4. If no events appear: check daemon is running (`cat ~/.contextus/runtime/daemon.pid | xargs ps -p`)
