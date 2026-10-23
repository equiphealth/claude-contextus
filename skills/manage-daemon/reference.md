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

**Do not launch with a bare `cmd & disown`.** That pattern only detaches the process from the *current shell's job table* — if the shell itself is a child of the calling agent/CLI process (true whenever you're launching from inside an agent's Bash tool, not a real interactive terminal), the daemon's parent is still that shell, which is still a descendant of the CLI session. Exiting the session can take the daemon down with it. This is not hypothetical — it happened in practice: `& disown` inside an agent Bash call left the daemon parented straight back to the `claude` process (confirmed via `ps -o pid,ppid`), and the `disown` itself silently failed under a restricted shell allowlist without erroring loudly.

Use `nohup` with explicit fd redirection instead, and verify reparenting after, don't just trust the launch succeeded silently:

```bash
# Check not already running
PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
  echo "Daemon already running (PID $PID) — use restart to replace it"
  exit 0
fi

# Launch fully detached: nohup (ignore SIGHUP) + redirect all three fds explicitly
# (bare `&` without stdin redirection can still leave the process attached to a
# controlling terminal/session in some shell configs) + disown (best-effort - if
# this silently no-ops under a restricted shell, nohup + fd redirection alone is
# still enough for the process to survive the parent shell exiting)
mkdir -p ~/.contextus/logs
CONTEXTUS_ROOT=~/src/claude-contextus
cd "$CONTEXTUS_ROOT"
nohup node --import tsx daemon/server.ts > ~/.contextus/logs/daemon.log 2>&1 < /dev/null &
disown

# Wait briefly for PID file
sleep 2
NEW_PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$NEW_PID" ] && ps -p "$NEW_PID" > /dev/null 2>&1; then
  echo "Daemon started (PID $NEW_PID)"
  curl -s http://127.0.0.1:37800/health | jq .

  # Verify it's actually detached, not just running - PID-file existence alone
  # does NOT prove this. A PPID of 1 (macOS/Linux init/launchd) confirms the
  # parent shell already exited and the daemon was reparented, i.e. it is
  # genuinely independent of whatever launched it.
  PPID=$(ps -o ppid= -p "$NEW_PID" | tr -d ' ')
  if [ "$PPID" = "1" ]; then
    echo "Confirmed detached (PPID 1 — reparented to init)"
  else
    echo "WARNING: daemon PPID is $PPID, not 1 — it may still be attached to the launching shell/session. Re-check with: ps -o pid,ppid,command -p $NEW_PID"
  fi
else
  echo "ERROR: daemon failed to start — check ~/.contextus/logs/daemon.log"
fi
```

### Restart

Run stop, then start (using the detached-launch pattern above, not a bare `& disown`). Report the new PID, health status, and the PPID-1 detachment confirmation.

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
- **When manually restarting from inside an agent session** (not the SessionStart hook's own launch path — that one's fine), always confirm PPID 1 after start. A daemon manually restarted mid-session and left attached to that session's process tree will die when the session exits, silently undoing the restart. See the Start section above for why `& disown` alone isn't sufficient.
