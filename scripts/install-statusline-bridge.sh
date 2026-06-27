#!/usr/bin/env bash
# install-statusline-bridge.sh
# Patches ~/.claude/statusline-command.sh to write context-window stats
# that contextus reads for token overflow protection (GitHub #17).
#
# Idempotent: safe to run multiple times. Skips if already patched.
# Called by contextus-setup and contextus-upgrade.

set -euo pipefail

STATUSLINE="${HOME}/.claude/statusline-command.sh"
MARKER="# contextus: token overflow protection bridge"

if [ ! -f "$STATUSLINE" ]; then
    echo "[contextus] No statusline script found at $STATUSLINE — skipping bridge install."
    echo "[contextus] Token overflow protection requires a statusline script."
    exit 0
fi

# Detect existing patch (either the exact marker or the old comment style)
if grep -q "contextus" "$STATUSLINE" 2>/dev/null && grep -q "context-stats.json" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Statusline bridge already installed — skipping."
    exit 0
fi

# Find the insertion point: after the jq extracts (used_pct line), before formatting.
if ! grep -q 'used_pct=' "$STATUSLINE"; then
    echo "[contextus] Could not find 'used_pct=' in statusline script — skipping bridge install."
    echo "[contextus] Manual setup required."
    exit 0
fi

# Create a temp file with the patch inserted after the used_pct= line
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

while IFS= read -r line; do
    printf '%s\n' "$line" >> "$TMPFILE"
    if [[ "$line" == used_pct=* ]]; then
        cat >> "$TMPFILE" << 'PATCH'

# contextus: token overflow protection bridge
if [ -n "$CLAUDE_CODE_SESSION_ID" ] && [ -n "$total_input" ]; then
    mkdir -p ~/.contextus/runtime
    printf '{"input_tokens":%s,"output_tokens":%s,"used_percentage":%s,"timestamp":%s}\n' \
        "$total_input" "$total_output" "${used_pct:-0}" "$(date +%s)" \
        > ~/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.context-stats.json
fi
PATCH
    fi
done < "$STATUSLINE"

mv "$TMPFILE" "$STATUSLINE"
chmod +x "$STATUSLINE"
echo "[contextus] Statusline bridge installed — token overflow protection active."
