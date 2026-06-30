---
name: manage-daemon
description: Stop, start, or restart the contextus daemon. Use after config changes or when the daemon is unhealthy.
---

# Manage Daemon

Control the contextus daemon lifecycle — stop, start, restart.

## Usage

```bash
/manage-daemon stop       # kill the running daemon
/manage-daemon start      # spawn a fresh daemon
/manage-daemon restart    # stop + start (picks up config changes)
/manage-daemon status     # show PID, uptime, health
```

## Instructions

When the user invokes this skill, determine the action from their argument (default: `status` if no argument given).

### File Locations

```
~/.contextus/runtime/daemon.pid    — PID of running daemon
~/.contextus/runtime/daemon.port   — port it's listening on (default 37800)
```

### Status

```bash
PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
  echo "Daemon running (PID $PID)"
  curl -s http://127.0.0.1:37800/health | jq .
else
  echo "Daemon not running"
fi
```

### Stop

```bash
PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
  kill "$PID"
  echo "Daemon stopped (was PID $PID)"
else
  echo "Daemon not running (nothing to stop)"
fi
```

### Start

```bash
# Check not already running
PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
  echo "Daemon already running (PID $PID) — use restart to replace it"
  exit 0
fi

# Launch daemon in background
CONTEXTUS_ROOT=~/src/claude-contextus
cd "$CONTEXTUS_ROOT" && node --import tsx daemon/server.ts &
disown

# Wait briefly for PID file
sleep 1
NEW_PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$NEW_PID" ] && ps -p "$NEW_PID" > /dev/null 2>&1; then
  echo "Daemon started (PID $NEW_PID)"
  curl -s http://127.0.0.1:37800/health | jq .
else
  echo "ERROR: daemon failed to start — check ~/.contextus/logs/daemon.log"
fi
```

### Restart

Run stop, then start. Report the new PID and health status.

## When to Use

- **After config changes** — daemon caches config at startup; restart picks up new values
- **After code changes** — if you're developing contextus itself and changed daemon code
- **When unhealthy** — `/context-doctor` or `/context-status` reports issues
- **Paranoid mode** — after enabling `logging.paranoid: true`, restart so it takes effect

## Notes

- The daemon writes its PID to `~/.contextus/runtime/daemon.pid` on successful startup
- SessionStart hook normally auto-starts the daemon — this skill is for manual control
- If start fails, check `~/.contextus/logs/daemon.log` for errors (model load failures, port conflicts)
- The daemon listens on port 37800 by default (localhost only)
