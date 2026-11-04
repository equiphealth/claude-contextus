#!/usr/bin/env bash
# daemon-restart.sh — stop the contextus daemon and start a verified replacement.
#
# Run this from your own terminal (not from inside an agent session): a daemon
# launched from a terminal survives on its own; one launched from inside an
# agent session dies with the session.
#
# Usage: bash ~/.contextus/scripts/daemon-restart.sh [--timeout SECS]
# Or (repo checkout): bash scripts/daemon-restart.sh [--timeout SECS]
# Or: pnpm daemon:restart
#
# Guarantees: preflight first (never kills a healthy daemon for a start that
# cannot work), then stop, spawn via the shared ensureDaemonRunning()
# (neutral dist / repo dist / dev tsx — never a hand-rolled launch), then poll
# /health until modelLoaded=true. A non-null warmupError aborts early (hard
# failure, not still-warming). Exit 0 only if the replacement is serving;
# exit 1 leaves a loud message plus a log tail — never a silent outage.
#
# Installed to ~/.contextus/scripts/ by install-discovery-scripts.sh.

set -u

TIMEOUT_SECS=180
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout=*) TIMEOUT_SECS="${1#--timeout=}" ;;
    --timeout) shift; [ $# -gt 0 ] || { echo "--timeout needs a value" >&2; exit 2; }; TIMEOUT_SECS="$1" ;;
    -h|--help)
      echo "Usage: $(basename "$0") [--timeout SECS]  (default 180)"
      exit 0
      ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done
case "$TIMEOUT_SECS" in
  ''|*[!0-9]*) echo "--timeout must be a positive number of seconds" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${HOME}/.contextus/runtime"
LOG_DIR="${HOME}/.contextus/logs"
PID_FILE="${RUNTIME_DIR}/daemon.pid"

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- Locate the shared launch mechanism. Repo layout (this script in
# <root>/scripts/) or installed layout (~/.contextus/scripts/ -> neutral
# copy). Never hand-roll a launch command — it drifts from resolveLaunch.
if [ -f "${SCRIPT_DIR}/lib/daemon-control.js" ]; then
  DC_PATH="${SCRIPT_DIR}/lib/daemon-control.js"
  TSX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
elif [ -f "${HOME}/.contextus/daemon/scripts/lib/daemon-control.js" ]; then
  DC_PATH="${HOME}/.contextus/daemon/scripts/lib/daemon-control.js"
  TSX_DIR="${HOME}/.contextus/daemon"
else
  fail "daemon-control.js not found (repo scripts/lib/ nor neutral copy) — re-run setup"
fi

# --- Preflight: prove the replacement can start before touching the old one ---
command -v node >/dev/null 2>&1 || fail "node not found on PATH"
command -v curl >/dev/null 2>&1 || fail "curl not found on PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "node $(node -v) < 22 — daemon requires node 22+ (repo has .nvmrc: run 'nvm use' first)"
# Resolve the launch target the same way spawnDaemon() will — a present
# node_modules is NOT proof (stale neutral copy without dist + no dev tsx
# still throws). Must succeed before the old daemon is touched. Runs from
# TSX_DIR so the bare `tsx` specifier resolves there, not in the invoker's cwd.
LAUNCH_TARGET="$(cd "${TSX_DIR}" && DC_PATH="$DC_PATH" NODE_NO_WARNINGS=1 node --import tsx -e "
import(process.env.DC_PATH).then((m) => {
  const l = m.resolveDaemonLaunch();
  console.log(l.cmd + ' ' + l.args[0]);
}).catch((e) => { console.error('NO LAUNCH TARGET: ' + (e && e.message)); process.exit(1); });
" 2>&1)"
[ "$?" -eq 0 ] && [ -n "$LAUNCH_TARGET" ] || fail "no runnable daemon build — ${LAUNCH_TARGET:-see above}. Fix with setup before restarting."
OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || echo '')"

daemon_url() {
  if [ -x "${HOME}/.contextus/scripts/daemon-url.sh" ]; then
    bash "${HOME}/.contextus/scripts/daemon-url.sh"
  else
    port="$(cat "${RUNTIME_DIR}/daemon.port" 2>/dev/null || echo 37800)"
    printf 'http://127.0.0.1:%s\n' "$port"
  fi
}

# --- Stop: SIGTERM, wait, SIGKILL fallback; refuse if it won't die ---
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  echo "Stopping daemon (PID ${OLD_PID})..."
  kill "$OLD_PID" 2>/dev/null || true
  for _ in $(seq 1 20); do
    kill -0 "$OLD_PID" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "SIGTERM ignored — sending SIGKILL..."
    kill -9 "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  kill -0 "$OLD_PID" 2>/dev/null && fail "old daemon (PID ${OLD_PID}) refuses to die — start aborted"
  echo "Old daemon stopped."
else
  echo "No live daemon found (stale or missing pidfile) — starting fresh."
fi

# --- Start: delegate to ensureDaemonRunning (neutral dist / repo dist /
# dev tsx as appropriate). The spawned daemon is detached + stdio-ignored +
# unref'd, so it survives this shell exiting.
echo "Spawning replacement via ensureDaemonRunning()..."
(cd "${TSX_DIR}" && DC_PATH="$DC_PATH" NODE_NO_WARNINGS=1 node --import tsx -e "
import(process.env.DC_PATH).then(async (m) => {
  const wasRunning = await m.ensureDaemonRunning();
  console.log(wasRunning ? 'Daemon already healthy' : 'Spawned (resolveLaunch picked the build)');
}).catch((e) => { console.error('SPAWN FAILED: ' + (e && e.message)); process.exit(1); });
" 2>&1)
[ "$?" -eq 0 ] || fail "spawn step failed — see output above"

# --- Verify: poll /health until modelLoaded, abort fast on warmupError ---
HEALTH_URL="$(daemon_url)/health"
echo "Waiting for model warmup (up to ${TIMEOUT_SECS}s) at ${HEALTH_URL} ..."
deadline=$((SECONDS + TIMEOUT_SECS))
HEALTH_BODY=''
while [ $SECONDS -lt $deadline ]; do
  HEALTH_BODY="$(curl -s --max-time 5 "${HEALTH_URL}" 2>/dev/null || echo '')"
  case "$HEALTH_BODY" in
    *'"modelLoaded":true'*)
      NEW_PID="$(cat "${PID_FILE}" 2>/dev/null || echo '?')"
      echo "Daemon healthy: modelLoaded=true (PID ${NEW_PID})"
      ps -o pid,ppid,command -p "$NEW_PID" 2>/dev/null || true
      echo "$HEALTH_BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const h=JSON.parse(s);console.log('provider='+h.provider+' model='+h.embeddingModel)}catch{}})" 2>/dev/null || true
      exit 0
      ;;
    *'"warmupError":null'*|'')
      # Still warming (or not yet listening) — keep waiting.
      ;;
    *)
      echo "Daemon reports a hard warmup failure:" >&2
      echo "$HEALTH_BODY" >&2
      fail "restart aborted — old daemon is stopped and the replacement failed to warm up; see ${LOG_DIR}/daemon.log"
      ;;
  esac
  sleep 2
done

echo "Timed out after ${TIMEOUT_SECS}s waiting for modelLoaded=true." >&2
echo "--- ${LOG_DIR}/daemon.log (tail) ---" >&2
tail -20 "${LOG_DIR}/daemon.log" >&2 || true
fail "replacement is not serving — old daemon is stopped; fix the cause above and re-run"
