#!/usr/bin/env bash
# daemon-restart.sh — stop the contextus daemon and start a verified replacement.
#
# Run this from your own terminal (not from inside an agent session): a daemon
# launched from a terminal survives on its own; one launched from inside an
# agent session dies with the session.
#
# Usage: ./scripts/daemon-restart.sh [--timeout SECS]
# Or:    pnpm daemon:restart
#
# Guarantees: preflight first (never kills a healthy daemon for a start that
# cannot work), then stop, detached start (nohup + fd redirection, log
# appended not truncated), then poll /health until modelLoaded=true.
# A non-null warmupError aborts early (hard failure, not still-warming).
# Exit 0 only if the replacement is serving; exit 1 leaves a loud message
# plus a log tail — never a silent outage.

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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${HOME}/.contextus/runtime"
LOG_DIR="${HOME}/.contextus/logs"
PID_FILE="${RUNTIME_DIR}/daemon.pid"
PORT_FILE="${RUNTIME_DIR}/daemon.port"
DEFAULT_PORT=37800

fail() { echo "ERROR: $*" >&2; exit 1; }

# --- Preflight: prove the replacement can start before touching the old one ---
command -v node >/dev/null 2>&1 || fail "node not found on PATH"
command -v curl >/dev/null 2>&1 || fail "curl not found on PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
[ "$NODE_MAJOR" -ge 22 ] || fail "node $(node -v) < 22 — daemon requires node 22+ (repo has .nvmrc: run 'nvm use' first)"
[ -f "${ROOT}/daemon/server.ts" ] || fail "daemon/server.ts missing under ${ROOT}"
[ -d "${ROOT}/node_modules" ] || fail "${ROOT}/node_modules missing — run install first"

PORT="$(cat "${PORT_FILE}" 2>/dev/null || echo "${DEFAULT_PORT}")"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
OLD_PID="$(cat "${PID_FILE}" 2>/dev/null || echo '')"

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
  kill -0 "$OLD_PID" 2>/dev/null && fail "old daemon (PID ${OLD_PID}) refuses to die — start aborted, port ${PORT} still held"
  echo "Old daemon stopped."
else
  echo "No live daemon found (stale or missing pidfile) — starting fresh."
fi

# --- Start: fully detached, log appended (never truncated) ---
mkdir -p "${LOG_DIR}"
cd "${ROOT}" || fail "cannot cd to ${ROOT}"
# nohup (survive HUP) + explicit fd redirection + stdin from /dev/null so the
# daemon holds no terminal; disown is best-effort (may no-op in some shells).
nohup node --import tsx daemon/server.ts >> "${LOG_DIR}/daemon.log" 2>&1 < /dev/null &
disown 2>/dev/null || true
echo "Launch issued, waiting for pidfile..."

NEW_PID=''
for _ in $(seq 1 30); do
  NEW_PID="$(cat "${PID_FILE}" 2>/dev/null || echo '')"
  if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then break; fi
  NEW_PID=''
  sleep 0.5
done
[ -n "$NEW_PID" ] || fail "no live pidfile after 15s — check ${LOG_DIR}/daemon.log tail:"
if [ -n "$OLD_PID" ] && [ "$NEW_PID" = "$OLD_PID" ]; then
  fail "pidfile still points at the old PID ${OLD_PID} — new daemon did not take over"
fi

# --- Verify: poll /health until modelLoaded, abort fast on warmupError ---
echo "Daemon process live (PID ${NEW_PID}) — waiting for model warmup (up to ${TIMEOUT_SECS}s)..."
deadline=$((SECONDS + TIMEOUT_SECS))
HEALTH_BODY=''
for _ in $(seq 1 $((TIMEOUT_SECS / 2 + 1))); do
  HEALTH_BODY="$(curl -s --max-time 5 "${HEALTH_URL}" 2>/dev/null || echo '')"
  case "$HEALTH_BODY" in
    *'"modelLoaded":true'*)
      echo "Daemon healthy: modelLoaded=true (PID ${NEW_PID}, port ${PORT}, $(node -e "try{const h=JSON.parse(process.argv[1]);console.log(h.provider+'/'+h.embeddingModel)}catch{console.log('model info unavailable')}" "$HEALTH_BODY"))"
      exit 0
      ;;
    *'"warmupError":null'*|'')
      # Still warming (or not yet listening) — keep waiting.
      ;;
    *)
      # warmupError is a non-null string: hard failure, waiting is pointless.
      echo "Daemon reports a hard warmup failure:" >&2
      echo "$HEALTH_BODY" >&2
      fail "restart aborted — old daemon is stopped and the replacement failed to warm up; see ${LOG_DIR}/daemon.log"
      ;;
  esac
  [ $SECONDS -ge $deadline ] && break
  sleep 2
done

echo "Timed out after ${TIMEOUT_SECS}s waiting for modelLoaded=true." >&2
echo "--- ${LOG_DIR}/daemon.log (tail) ---" >&2
tail -20 "${LOG_DIR}/daemon.log" >&2 || true
fail "replacement is not serving — old daemon is stopped; fix the cause above and re-run"
