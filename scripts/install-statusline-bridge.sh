#!/usr/bin/env bash
# install-statusline-bridge.sh
# Installs the token overflow protection bridge into ~/.claude/statusline-command.sh.
#
# The bridge writes context-window stats to a file that contextus reads before
# deciding whether to inject context (GitHub #17). It's SELF-CONTAINED: extracts
# values from the raw JSON stdin using jq (preferred) or sed (fallback).
#
# Handles three cases:
#   1. Statusline exists, already patched → skip
#   2. Statusline exists, not patched → insert bridge after stdin read
#   3. No statusline exists → create a minimal one with bridge + basic display
#
# Idempotent: safe to run multiple times.
# Called by contextus-setup and contextus-upgrade.

set -euo pipefail

STATUSLINE="${HOME}/.claude/statusline-command.sh"
MARKER="# contextus: token overflow protection bridge"

# --- The bridge block (self-contained, jq-optional) ---
# Uses _ctx_ prefix to avoid colliding with host script variables.
# Tries jq first; falls back to sed for numeric JSON extraction.
read -r -d '' BRIDGE_BLOCK << 'BRIDGE' || true
# contextus: token overflow protection bridge
# Writes context-window stats for the daemon to read before injecting context.
# Self-contained: extracts values from $input (stdin JSON), works with or without jq.
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    if command -v jq >/dev/null 2>&1; then
        _ctx_input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
        _ctx_output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
        _ctx_used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
    else
        # jq-free fallback: sed extracts numeric values from known JSON keys
        _ctx_input_tokens=$(echo "$input" | sed -n 's/.*"total_input_tokens" *: *\([0-9.]*\).*/\1/p')
        _ctx_output_tokens=$(echo "$input" | sed -n 's/.*"total_output_tokens" *: *\([0-9.]*\).*/\1/p')
        _ctx_used_pct=$(echo "$input" | sed -n 's/.*"used_percentage" *: *\([0-9.]*\).*/\1/p')
        _ctx_input_tokens=${_ctx_input_tokens:-0}
        _ctx_output_tokens=${_ctx_output_tokens:-0}
        _ctx_used_pct=${_ctx_used_pct:-0}
    fi
    if [ "${_ctx_input_tokens:-0}" != "0" ] && [ "${_ctx_input_tokens:-0}" != "null" ]; then
        mkdir -p ~/.contextus/runtime
        printf '{"input_tokens":%s,"output_tokens":%s,"used_percentage":%s,"timestamp":%s}\n' \
            "$_ctx_input_tokens" "$_ctx_output_tokens" "$_ctx_used_pct" "$(date +%s)" \
            > ~/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.context-stats.json
    fi
    unset _ctx_input_tokens _ctx_output_tokens _ctx_used_pct
fi
BRIDGE

# --- Case 1: Already patched ---
if [ -f "$STATUSLINE" ] && grep -qF "$MARKER" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Statusline bridge already installed — skipping."
    exit 0
fi

# Also detect older patch style
if [ -f "$STATUSLINE" ] && grep -q "contextus" "$STATUSLINE" 2>/dev/null && grep -q "context-stats.json" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Statusline bridge already installed (legacy marker) — skipping."
    exit 0
fi

# --- Case 3: No statusline exists — create a minimal one ---
if [ ! -f "$STATUSLINE" ]; then
    echo "[contextus] No statusline script found — creating minimal one with bridge."
    mkdir -p "$(dirname "$STATUSLINE")"
    cat > "$STATUSLINE" << 'MINIMAL'
#!/usr/bin/env bash
# Minimal statusline created by contextus for token overflow protection.
# Customize freely — the bridge block (marked below) is the only required part.
input=$(cat)

MINIMAL
    # Append the bridge block
    printf '%s\n' "$BRIDGE_BLOCK" >> "$STATUSLINE"
    # Add a basic status display after the bridge
    cat >> "$STATUSLINE" << 'DISPLAY'

# Basic status display (customize or replace as desired)
if command -v jq >/dev/null 2>&1; then
    _model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
    _in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
    _pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
    _in_k=$(echo "scale=1; $_in / 1000" | bc 2>/dev/null || echo "$_in")
    if [ -n "$_pct" ]; then
        printf "%s | %sK in | %s%%" "$_model" "$_in_k" "$(printf '%.0f' "$_pct")"
    else
        printf "%s | %sK in" "$_model" "$_in_k"
    fi
fi
DISPLAY
    chmod +x "$STATUSLINE"
    echo "[contextus] Created $STATUSLINE with bridge + basic display."
    exit 0
fi

# --- Case 2: Statusline exists, needs patching ---
# Find the stdin-read line. Common patterns: input=$(cat), INPUT=$(cat -), etc.
STDIN_PATTERN='=$(cat'
if ! grep -q "$STDIN_PATTERN" "$STATUSLINE"; then
    echo "[contextus] Could not find stdin-read pattern ('\$(cat') in statusline script."
    echo "[contextus] Will prepend bridge after shebang line instead."
    # Fallback: insert after shebang (line 1) with its own stdin read
    TMPFILE=$(mktemp)
    trap 'rm -f "$TMPFILE"' EXIT
    head -1 "$STATUSLINE" > "$TMPFILE"
    printf '\n# Stdin captured by contextus bridge (original script may also read it)\nif [ -z "${input:-}" ]; then input=$(cat); fi\n' >> "$TMPFILE"
    printf '%s\n' "$BRIDGE_BLOCK" >> "$TMPFILE"
    tail -n +2 "$STATUSLINE" >> "$TMPFILE"
    mv "$TMPFILE" "$STATUSLINE"
    chmod +x "$STATUSLINE"
    echo "[contextus] Statusline bridge installed (prepended after shebang)."
    exit 0
fi

# Normal case: insert after the first stdin-read line
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

INSERTED=0
while IFS= read -r line; do
    printf '%s\n' "$line" >> "$TMPFILE"
    if [ $INSERTED -eq 0 ] && echo "$line" | grep -q "$STDIN_PATTERN"; then
        printf '\n%s\n' "$BRIDGE_BLOCK" >> "$TMPFILE"
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
