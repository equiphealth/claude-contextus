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
#   CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=right             — EXPERIMENTAL right-alignment.
#     Width detection itself is reliable: Claude Code v2.1.153+ sets $COLUMNS/$LINES
#     for the statusline subprocess specifically because `tput cols` can't read a real
#     terminal from inside it (no controlling tty) — confirmed live: $COLUMNS correctly
#     reports the real width, tty absent, tput cols agrees. The math this script does
#     with that width is correct. What ISN'T verified: whether Claude Code's status bar
#     actually renders raw padding characters as literal column positions, or reflows/
#     normalizes the string in its own UI widget — if the latter, the padding math runs
#     fine but visually collapses to something indistinguishable from `newline`. Falls
#     back to `newline` layout automatically if $COLUMNS/tput both come up empty (e.g.
#     pre-2.1.153 Claude Code).
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
# (prints nothing, adds no latency beyond one jq call + a line count) otherwise.
if [ "${CONTEXTUS_DEBUG_STATUSLINE:-0}" = "1" ] && [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    _ctx_dbg_file="${HOME}/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.last-injection.json"
    _ctx_dbg_line=""
    if [ -f "$_ctx_dbg_file" ]; then
        _ctx_dbg_line=$(jq -r '
            def pct(n): (n * 100 | round);
            # Bounded file label: first injected file (basename, no dir/.md) plus a
            # "+N" count for the rest — full list still lives in injectedFiles in the
            # JSON for anyone who wants it; the RENDERED line just needs "which one
            # led" not an exhaustive roll call (a status bar is not the place for that).
            def shortfile: split("/") | last | rtrimstr(".md");
            def filesLabel:
                (.injectedFiles // []) as $f
                | if ($f | length) == 0 then ""
                  elif ($f | length) == 1 then " src:" + ($f[0] | shortfile)
                  else " src:" + ($f[0] | shortfile) + "+" + (($f | length - 1) | tostring)
                  end;
            if .injected then
                "ctx✓ " + (pct(.bestScore)|tostring) + "%/" + (pct(.floor)|tostring) + "%"
                + " " + (.count|tostring) + "/" + (.candidates|tostring)
                + " " + (.tokensInjected|tostring) + "tk " + (.latencyMs|tostring) + "ms"
                + " exp:" + .expansion + " hyb:" + .hybrid + " budget:" + .capacityTier
                + filesLabel
                + (if .recentUsefulPct != null then " useful:" + (.recentUsefulPct|tostring) + "%(" + (.recentUsefulSamples|tostring) + ")" else " useful:n/a" end)
            else
                "ctx✗ " + (pct(.bestScore)|tostring) + "%<" + (pct(.floor)|tostring) + "%"
                + " " + (.candidates|tostring) + "cand " + (.latencyMs|tostring) + "ms"
                + " exp:" + .expansion + " hyb:" + .hybrid + " budget:" + .capacityTier
                + (if .recentUsefulPct != null then " useful:" + (.recentUsefulPct|tostring) + "%(" + (.recentUsefulSamples|tostring) + ")" else " useful:n/a" end)
            end
        ' "$_ctx_dbg_file" 2>/dev/null || echo "")
    fi

    # Captures indicator: new lines in ~/.contextus/captures.log (written by
    # /capture and /delete) since this SESSION's statusline last rendered.
    # Watermark is a line count, not a timestamp — sidesteps ISO8601 parsing
    # differences between BSD date (macOS) and GNU date (Linux) entirely.
    # KNOWN LIMITATION: captures.log has no absolute project path (just a
    # relative filename + scope: project/user), so a capture in a DIFFERENT
    # concurrent session/project also increments this — it's a global signal,
    # not perfectly project-scoped. Acceptable for a debugging aid.
    _ctx_cap_indicator=""
    _ctx_caps_log="${HOME}/.contextus/captures.log"
    if [ -f "$_ctx_caps_log" ]; then
        _ctx_cap_watermark="${HOME}/.contextus/runtime/${CLAUDE_CODE_SESSION_ID}.captures-watermark"
        _ctx_cap_count=$(wc -l < "$_ctx_caps_log" 2>/dev/null | tr -d ' ')
        _ctx_cap_prev=$(cat "$_ctx_cap_watermark" 2>/dev/null)
        # No watermark yet (first render this session) — establish a baseline
        # rather than reporting the entire pre-existing log as "new".
        if [ -z "$_ctx_cap_prev" ]; then
            _ctx_cap_prev="$_ctx_cap_count"
        fi
        if [ -n "$_ctx_cap_count" ] && [ "$_ctx_cap_count" -gt "$_ctx_cap_prev" ] 2>/dev/null; then
            _ctx_cap_new=$((_ctx_cap_count - _ctx_cap_prev))
            _ctx_cap_last=$(tail -n 1 "$_ctx_caps_log" | awk -F' \\| ' '{print $3}')
            _ctx_cap_indicator="new:+${_ctx_cap_new}(${_ctx_cap_last})"
            unset _ctx_cap_new _ctx_cap_last
        fi
        printf '%s' "$_ctx_cap_count" > "$_ctx_cap_watermark" 2>/dev/null
        unset _ctx_cap_count _ctx_cap_prev
    fi

    if [ -n "$_ctx_dbg_line" ] && [ -n "$_ctx_cap_indicator" ]; then
        _ctx_dbg_line="${_ctx_dbg_line} ${_ctx_cap_indicator}"
    elif [ -n "$_ctx_cap_indicator" ]; then
        _ctx_dbg_line="$_ctx_cap_indicator"
    fi
    unset _ctx_cap_indicator

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
DEBUG

print_help() {
    echo "[contextus] Toggle with: export CONTEXTUS_DEBUG_STATUSLINE=1 (or 0 to silence)"
    echo "[contextus] Layout: export CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=newline|inline|right (default: newline)"
    echo "[contextus]   'right' is EXPERIMENTAL — width detection is confirmed reliable, but whether"
    echo "[contextus]   Claude Code's status bar actually renders it as visually right-aligned (vs."
    echo "[contextus]   reflowing to something that looks like 'newline') isn't guaranteed. Try it;"
    echo "[contextus]   fall back to 'newline' if it doesn't look right."
    echo "[contextus] No single default looks right against every statusline script — if none of these"
    echo "[contextus] fit yours, you may need to adjust formatting: edit the block marked"
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
