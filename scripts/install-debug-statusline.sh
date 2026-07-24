#!/usr/bin/env bash
# install-debug-statusline.sh
# Installs an OPT-IN verbose debug line into ~/.claude/statusline-command.sh,
# showing what contextus just did on the last /query: injected count, best
# match vs floor, tokens, latency, expansion/hybrid/capacity status, per-source
# breakdown, and a rolling "% useful" from background usage evaluation.
#
# Gated behind an env var so it's silent by default even after install — set
# CONTEXTUS_DEBUG_STATUSLINE=1 in your shell profile to turn it on, unset (or
# set to anything else) to go quiet again. No reinstall needed either way.
#
# LAYOUT (no universal default — every user's existing statusline script is
# different, so there's no join format guaranteed to look right for everyone):
#   CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=newline (default) — own line below the rest
#   CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=inline            — appended " | ..." on the same line
#   CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=right             — right-aligned to terminal width,
#     best-effort: statuslines run in a subprocess with no real tty attached, so terminal
#     width detection (tput cols / $COLUMNS) is unreliable there — falls back to newline
#     layout if width can't be determined, rather than producing broken padding.
# If none of these look right against YOUR statusline script, edit the block below
# (marked "# contextus: verbose debug statusline") directly — this is a debugging aid,
# not something worth over-engineering a universal formatter for.
#
# Reads ~/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.last-injection.json,
# written by the daemon after every /query (see lib/debug-statusline.ts).
# Requires jq — the snapshot has a nested `sources` object that isn't worth
# hand-parsing with sed the way the capacity bridge's flat fields are.
#
# Idempotent: safe to run multiple times. Independent of, and composes with,
# install-statusline-bridge.sh (token-overflow protection) — both patch the
# same file, each behind their own marker, in whatever order you install them.
# Wired into contextus-setup and contextus-upgrade (installed alongside the
# capacity bridge) — safe to auto-install everywhere since it's silent by
# default; the env-var gate above is what makes it opt-in, not the install step.

set -euo pipefail

STATUSLINE="${HOME}/.claude/statusline-command.sh"
MARKER="# contextus: verbose debug statusline"

if ! command -v jq >/dev/null 2>&1; then
    echo "[contextus] jq is required for the debug statusline (nested JSON fields) — install jq and re-run."
    exit 1
fi

# --- The debug display block ---
read -r -d '' DEBUG_BLOCK << 'DEBUG' || true
# contextus: verbose debug statusline
# Prints the last /query outcome when CONTEXTUS_DEBUG_STATUSLINE=1. Silent
# (prints nothing, adds no latency beyond one jq call) otherwise.
if [ "${CONTEXTUS_DEBUG_STATUSLINE:-0}" = "1" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    _ctx_dbg_file="${HOME}/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.last-injection.json"
    if [ -f "$_ctx_dbg_file" ]; then
        _ctx_dbg_line=$(jq -r '
            def pct(n): (n * 100 | round);
            if .injected then
                "ctx✓ " + (pct(.bestScore)|tostring) + "%/" + (pct(.floor)|tostring) + "%"
                + " " + (.count|tostring) + "/" + (.candidates|tostring)
                + " " + (.tokensInjected|tostring) + "tk " + (.latencyMs|tostring) + "ms"
                + " exp:" + .expansion + " hyb:" + .hybrid + " cap:" + .capacityTier
                + " src:" + ([.sources | to_entries[] | "\(.key)\(.value)"] | join(","))
                + (if .recentUsefulPct != null then " useful:" + (.recentUsefulPct|tostring) + "%(" + (.recentUsefulSamples|tostring) + ")" else " useful:n/a" end)
            else
                "ctx✗ " + (pct(.bestScore)|tostring) + "%<" + (pct(.floor)|tostring) + "%"
                + " " + (.candidates|tostring) + "cand " + (.latencyMs|tostring) + "ms"
                + " exp:" + .expansion + " hyb:" + .hybrid + " cap:" + .capacityTier
                + (if .recentUsefulPct != null then " useful:" + (.recentUsefulPct|tostring) + "%(" + (.recentUsefulSamples|tostring) + ")" else " useful:n/a" end)
            end
        ' "$_ctx_dbg_file" 2>/dev/null || echo "")
        if [ -n "$_ctx_dbg_line" ]; then
            case "${CONTEXTUS_DEBUG_STATUSLINE_LAYOUT:-newline}" in
                inline)
                    printf ' | %s' "$_ctx_dbg_line"
                    ;;
                right)
                    _ctx_dbg_cols="${COLUMNS:-}"
                    if [ -z "$_ctx_dbg_cols" ] && command -v tput >/dev/null 2>&1; then
                        _ctx_dbg_cols=$(tput cols 2>/dev/null || echo "")
                    fi
                    if [ -n "$_ctx_dbg_cols" ] && [ "$_ctx_dbg_cols" -gt 0 ] 2>/dev/null; then
                        _ctx_dbg_pad=$((_ctx_dbg_cols - ${#_ctx_dbg_line}))
                        if [ "$_ctx_dbg_pad" -gt 0 ]; then
                            printf '\n%*s' "$_ctx_dbg_pad" ""
                        else
                            printf '\n'
                        fi
                        printf '%s' "$_ctx_dbg_line"
                    else
                        # Width undetectable (no tty in this subprocess) — degrade to newline
                        printf '\n%s' "$_ctx_dbg_line"
                    fi
                    unset _ctx_dbg_cols _ctx_dbg_pad
                    ;;
                *)
                    printf '\n%s' "$_ctx_dbg_line"
                    ;;
            esac
        fi
    fi
fi
DEBUG

print_help() {
    echo "[contextus] Toggle with: export CONTEXTUS_DEBUG_STATUSLINE=1 (or 0 to silence)"
    echo "[contextus] Layout: export CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=newline|inline|right (default: newline)"
    echo "[contextus] No single default looks right against every statusline script — if this one"
    echo "[contextus] doesn't fit yours, you may need to adjust formatting: edit the block marked"
    echo "[contextus] '# contextus: verbose debug statusline' directly in $STATUSLINE"
}

# --- Case 1: Already patched ---
if [ -f "$STATUSLINE" ] && grep -qF "$MARKER" "$STATUSLINE" 2>/dev/null; then
    echo "[contextus] Debug statusline already installed — skipping."
    print_help
    exit 0
fi

# --- Case 2: No statusline exists — create a minimal one ---
if [ ! -f "$STATUSLINE" ]; then
    echo "[contextus] No statusline script found — creating one with the debug block."
    mkdir -p "$(dirname "$STATUSLINE")"
    cat > "$STATUSLINE" << 'MINIMAL'
#!/usr/bin/env bash
# Created by contextus for the verbose debug statusline.
# This script runs after each assistant turn. Whatever it prints to stdout
# appears in the Claude Code status bar.
input=$(cat)

MINIMAL
    printf '%s\n' "$DEBUG_BLOCK" >> "$STATUSLINE"
    printf '\n_ctx_dbg_out=$(printf "")\n' >> "$STATUSLINE"
    chmod +x "$STATUSLINE"
    echo "[contextus] Created $STATUSLINE with the debug block."
    print_help
    exit 0
fi

# --- Case 3: Statusline exists — append the block at the end.
# Unlike the capacity bridge (which must run BEFORE the daemon's own /query,
# so it has to sit early, right after stdin is read), this block only reads a
# file the daemon already wrote and prints to stdout — order relative to the
# rest of the script doesn't matter, so appending is simplest and safest.
printf '\n%s\n' "$DEBUG_BLOCK" >> "$STATUSLINE"
echo "[contextus] Debug statusline installed — printing appended to existing statusline output."
print_help
