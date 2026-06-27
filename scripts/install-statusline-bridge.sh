#!/usr/bin/env bash
# install-statusline-bridge.sh
# Patches ~/.claude/statusline-command.sh to write context-window stats
# that contextus reads for token overflow protection (GitHub #17).
#
# The bridge block is SELF-CONTAINED: it extracts values from the raw JSON
# input using jq, independent of any variable names the host script uses.
# It's inserted after the first `input=$(cat)` or equivalent stdin-read line.
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

# Detect existing patch
if grep -qF "$MARKER" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Statusline bridge already installed — skipping."
    exit 0
fi

# Also detect older patch style (before the self-contained rewrite)
if grep -q "contextus" "$STATUSLINE" 2>/dev/null && grep -q "context-stats.json" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Statusline bridge already installed (legacy marker) — skipping."
    exit 0
fi

# Find the stdin-read line. Common patterns:
#   input=$(cat)
#   input="$(cat)"
#   INPUT=$(cat -)
#   read -r input < /dev/stdin
# We look for a line that assigns stdin to a variable (the JSON payload).
STDIN_PATTERN='=$(cat'
if ! grep -q "$STDIN_PATTERN" "$STATUSLINE"; then
    echo "[contextus] Could not find stdin-read pattern in statusline script."
    echo "[contextus] Token overflow protection requires the statusline to read JSON from stdin."
    echo "[contextus] Expected pattern: variable=\$(cat) or similar."
    echo "[contextus] Manual setup: add the bridge block after your stdin read. See docs."
    exit 0
fi

# Build the patch — self-contained, references only $input (the captured stdin JSON)
# and standard env vars. Works regardless of host script's variable naming.
PATCH='
# contextus: token overflow protection bridge
# Writes context-window stats for the daemon to read before injecting context.
# Self-contained: extracts values from $input via jq, no host-script dependencies.
if [ -n "$CLAUDE_CODE_SESSION_ID" ] && command -v jq >/dev/null 2>&1; then
    _ctx_input_tokens=$(echo "$input" | jq -r ".context_window.total_input_tokens // 0")
    _ctx_used_pct=$(echo "$input" | jq -r ".context_window.used_percentage // 0")
    if [ "$_ctx_input_tokens" != "0" ] && [ "$_ctx_input_tokens" != "null" ]; then
        mkdir -p ~/.contextus/runtime
        _ctx_output_tokens=$(echo "$input" | jq -r ".context_window.total_output_tokens // 0")
        printf "{\"input_tokens\":%s,\"output_tokens\":%s,\"used_percentage\":%s,\"timestamp\":%s}\n" \
            "$_ctx_input_tokens" "$_ctx_output_tokens" "$_ctx_used_pct" "$(date +%s)" \
            > ~/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.context-stats.json
    fi
    unset _ctx_input_tokens _ctx_output_tokens _ctx_used_pct
fi'

# Insert after the first line matching the stdin-read pattern
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

INSERTED=0
while IFS= read -r line; do
    printf '%s\n' "$line" >> "$TMPFILE"
    if [ $INSERTED -eq 0 ] && echo "$line" | grep -q "$STDIN_PATTERN"; then
        printf '%s\n' "$PATCH" >> "$TMPFILE"
        INSERTED=1
    fi
done < "$STATUSLINE"

if [ $INSERTED -eq 0 ]; then
    echo "[contextus] Failed to find insertion point — statusline unchanged."
    exit 1
fi

mv "$TMPFILE" "$STATUSLINE"
chmod +x "$STATUSLINE"
echo "[contextus] Statusline bridge installed — token overflow protection active."
