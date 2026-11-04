#!/usr/bin/env bash
# daemon-url.sh — print the contextus daemon base URL (single canonical place).
#
# Same priority as getBaseURL() in scripts/lib/daemon-control.js:
#   1. $CONTEXTUS_DAEMON_URL if set (verbatim)
#   2. port from ~/.contextus/runtime/daemon.port (validated 1-65535)
#   3. $CONTEXTUS_DAEMON_PORT, else the 37800 last resort
#
# Installed to ~/.contextus/scripts/ by install-discovery-scripts.sh.
# Skills and docs must call `bash ~/.contextus/scripts/daemon-url.sh` —
# never inline this fallback chain (an inlined copy already caused one
# phantom-project incident by hashing bytes no one intended).
set -u

if [ -n "${CONTEXTUS_DAEMON_URL:-}" ]; then
  printf '%s\n' "$CONTEXTUS_DAEMON_URL"
  exit 0
fi

port="$(cat "${HOME}/.contextus/runtime/daemon.port" 2>/dev/null || true)"
port="$(printf '%s' "$port" | tr -d '[:space:]')"
if [ -n "$port" ] && [ "$port" -gt 0 ] 2>/dev/null && [ "$port" -lt 65536 ] 2>/dev/null; then
  printf 'http://127.0.0.1:%s\n' "$port"
  exit 0
fi

printf 'http://127.0.0.1:%s\n' "${CONTEXTUS_DAEMON_PORT:-37800}"
