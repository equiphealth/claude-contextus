#!/usr/bin/env bash
# find-contextus-root.sh
# Discovers contextus installation root for use by skills and scripts.
# Outputs path to stdout, exits 0 on success, non-zero on failure.

set -euo pipefail

# Load daemon config (port, URL)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/daemon-config.sh"

# Try daemon first (authoritative if running)
DAEMON_ROOT=""
if command -v curl &>/dev/null; then
    if command -v jq &>/dev/null; then
        DAEMON_ROOT=$(curl -s "${CONTEXTUS_DAEMON_URL}/health" 2>/dev/null | jq -r '.installRoot // empty' || true)
    else
        DAEMON_ROOT=$(curl -s "${CONTEXTUS_DAEMON_URL}/health" 2>/dev/null | grep -o '"installRoot":"[^"]*"' | cut -d'"' -f4 || true)
    fi

    if [ -n "$DAEMON_ROOT" ] && [ -f "$DAEMON_ROOT/package.json" ]; then
        echo "$DAEMON_ROOT"
        exit 0
    fi
fi

# Fall back to search (daemon not running or old version)
for dir in \
    ~/.claude/plugins/contextus \
    ~/src/claude-contextus \
    ~/dev/claude-contextus
do
    if [ -f "$dir/package.json" ]; then
        # Verify it's actually contextus (not some other package)
        if grep -q '"name"[[:space:]]*:[[:space:]]*"claude-contextus"' "$dir/package.json" 2>/dev/null; then
            echo "$dir"
            exit 0
        fi
    fi
done

# Not found
echo "Error: contextus installation not found" >&2
echo "  Tried:" >&2
echo "    - Daemon query (${CONTEXTUS_DAEMON_URL}/health)" >&2
echo "    - ~/.claude/plugins/contextus (plugin install)" >&2
echo "    - ~/src/claude-contextus (dev mode)" >&2
echo "    - ~/dev/claude-contextus (dev mode)" >&2
exit 1
