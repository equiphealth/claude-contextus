---
name: contextus-watch
description: Live activity stream — colored, formatted follower over daemon.log showing retrievals, no-injects, errors, embeds in real time. The "what is contextus doing?" command.
---

# Contextus Watch

Pretty `tail -f` over the daemon's activity log. Shows what contextus is doing in real
time — retrievals, skipped prompts, errors, embeds — without tailing JSON or curling
endpoints.

## Usage

```bash
# Live stream, all projects
/contextus-watch

# Filter to one project
/contextus-watch --project automation

# Show extra detail (scores, dropped patterns)
/contextus-watch --verbose

# Replay the last hour, then follow live
/contextus-watch --since 1h

# Replay only (don't follow)
/contextus-watch --since 30m --no-follow

# Raw JSONL (for piping to jq)
/contextus-watch --json

# PARANOID: full prompt + injection payload
/contextus-watch --paranoid

# Paranoid + verbose = full injection text (not truncated)
/contextus-watch --paranoid -v
```

Engine (dev/direct):

```bash
TSX=~/src/claude-contextus/node_modules/.bin/tsx
$TSX ~/src/claude-contextus/scripts/watch.ts [options]
```

## What It Shows

| Icon | Color | Meaning |
|---|---|---|
| `✓` | green | Retrieved patterns (injection happened) |
| `○` | dim | No retrieval (below floor) |
| `◆` | magenta | Calibration evaluation completed |
| `↻` | cyan | Embed / reconcile activity |
| `⚠` | yellow | Warning (timeout, retry) |
| `✗` | red | Error (model down, storage failure) |
| `·` | default | Other daemon lifecycle events |

## Example Output

```
contextus watch — project: automation (verbose)
────────────────────────────────────────────────────────────
14:23:42 ✓ Retrieved 2 patterns [automation]
         scores=0.87/0.81 latency=163ms dropped=3
14:25:10 ○ No retrieval [automation]
         reason=below_floor best=0.62
14:32:15 ⚠ Chroma query timeout [automation]
         timeout=2400ms retrying
14:33:01 ✓ Retrieved 5 patterns [automation]
         scores=0.91/0.84/0.79/0.74/0.71 latency=210ms dropped=0
── live ──
```

## Paranoid Mode

When `--paranoid` is passed, watch tails `~/.contextus/logs/paranoid.jsonl` instead
of daemon.log. This shows the **full prompt text** and **complete injection payload**
for every query — everything sent to the LLM.

**Requires**: `logging.paranoid: true` in your config (off by default for privacy).

Enable in `.claude/contextus.json`:
```json
{ "logging": { "paranoid": true } }
```

Output in paranoid mode shows each event as a card with PROMPT and INJECTED sections.
Use `-v` to see the full injection text (default truncates at 300 chars).

## Design

`watch` is a READ-ONLY formatter over `~/.contextus/logs/daemon.log`. It:
- Adds no new infrastructure (no server, no daemon, no port)
- Follows the existing human-format log stream (LOGGING.md)
- Filters by project and time client-side
- Uses `fs.watch` for low-latency following with polling fallback
- Handles log rotation (detects truncation, resets position)

## Related

- `/context-status` — point-in-time dashboard (aggregated stats)
- `/rebuild-embeddings` — triggers activity you'll see in watch
- `~/.contextus/logs/daemon.log` — the raw file (always readable without this tool)
