#!/usr/bin/env bash
# daemon-config.sh
# Daemon connection discovery — read actual port from daemon.port file if daemon
# is running, otherwise fall back to default. Source this in scripts that need
# to talk to the daemon.

RUNTIME_DIR="${CONTEXTUS_RUNTIME_DIR:-$HOME/.contextus/runtime}"
PORT_FILE="${RUNTIME_DIR}/daemon.port"

# Read actual port from daemon.port if it exists (daemon wrote it at startup),
# otherwise fall back to env var or default (37800)
if [ -f "$PORT_FILE" ]; then
    DAEMON_PORT=$(cat "$PORT_FILE")
else
    DAEMON_PORT="${CONTEXTUS_DAEMON_PORT:-37800}"
fi

# Export for scripts
export CONTEXTUS_DAEMON_URL="http://127.0.0.1:${DAEMON_PORT}"
export CONTEXTUS_RUNTIME_DIR="$RUNTIME_DIR"
export CONTEXTUS_PID_FILE="${RUNTIME_DIR}/daemon.pid"
