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
  curl -s "$(bash ~/.contextus/scripts/daemon-url.sh)/health" | jq .
else
  echo "Daemon not running"
fi
```

Never inline the port-resolution fallback chain (`$CONTEXTUS_DAEMON_URL` →
`daemon.port` file → 37800) — always call `daemon-url.sh`. An inlined copy
drifting from the canonical one already caused a real incident (phantom
project from hashing the wrong bytes).

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

**Don't hand-roll a launch command — delegate to `ensureDaemonRunning()`.**
`scripts/lib/daemon-control.js` already resolves neutral-dist vs repo-dist vs
`CONTEXTUS_DEV=1` tsx-on-source correctly, and spawns via Node's own
`detached: true` + `unref()` (not a shell `nohup ... & disown`, which this
doc used to recommend — that pattern is one layer too low: it can leave the
process parented to the calling shell if the shell itself is a child of the
agent/CLI session, and `disown` can silently no-op under a restricted shell
allowlist with no error). A hand-rolled `node --import tsx daemon/server.ts`
also skips the neutral-dist check entirely, which is exactly backwards —
confirmed live (2026-11-01): a manual tsx-on-repo-source launch either
failed outright (environment-specific native-module issue in the repo's own
`node_modules`) or lost a race against the correct neutral-dist spawn
elsewhere, while the WRONG approach was the one being followed as "the
documented procedure." Never reimplement this a second, divergent way:

```bash
cd <repo-root>   # wherever this plugin checkout actually lives — don't hardcode a path
node --import tsx -e "
import('./scripts/lib/daemon-control.js').then(async (m) => {
  const wasRunning = await m.ensureDaemonRunning();
  console.log(wasRunning ? 'Daemon already healthy' : 'Spawned (resolveLaunch picked neutral dist / repo dist / dev tsx as appropriate)');
});
"

# Give it a moment, then verify the SAME way regardless of which build ran:
sleep 2
PID=$(cat ~/.contextus/runtime/daemon.pid 2>/dev/null)
if [ -n "$PID" ] && ps -p "$PID" > /dev/null 2>&1; then
  echo "Daemon running (PID $PID)"
  ps -o pid,ppid,command -p "$PID"   # confirm PPID 1 (reparented) AND which build actually launched
  curl -s "$(bash ~/.contextus/scripts/daemon-url.sh)/health" | jq .
else
  echo "ERROR: daemon failed to start — check ~/.contextus/logs/daemon.log"
fi
```

If `ensureDaemonRunning()` throws (no runnable build at all — neutral dist
missing, repo dist missing, no repo tsx), it names the fix directly: `node
scripts/sync-neutral-daemon.js`. Don't work around that by falling back to
a manual launch — that's the exact anti-pattern this section now warns
against.

### Restart

Run stop, then start (using `ensureDaemonRunning()` above, never a hand-rolled launch command). Report the new PID, which build actually launched (`ps -o command`), health status, and PPID 1.

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
- **In Muse Code, do not restart the daemon from inside an agent session.** Unmanaged backgrounding is blocked, and a process started in session dies with the session. Do not stop a healthy daemon unless a surviving replacement is already guaranteed outside the session. For a restart, give the user the exact terminal commands, have them run those outside the session, then verify health after. A daemon run under a managed session is temporary only, and must be labeled as a bridge, not a restart.
