#!/usr/bin/env bash
# test-contextus-retrieval — end-to-end, self-driven contextus test.
# Fires a headless `claude -p` against a project with the plugin loaded (so the
# real UserPromptSubmit hook chain runs), then reports BOTH halves:
#   1. what the daemon retrieved + scores (from the daemon log)   — the mechanism
#   2. what Claude actually returned, incl. any "Context: used:" footer — the outcome
#
# Usage:  test-retrieval.sh <project-dir> "<query>"
# Example: test-retrieval.sh ~/src/my-equip-mobile/automation "logging patterns?"
set -euo pipefail
PROJ="${1:?need project dir}"; QUERY="${2:?need query}"
CTX="$HOME/src/claude-contextus"
LOG="$HOME/.contextus/logs/daemon.log"

cd "$PROJ"
BEFORE=$(wc -l < "$LOG" 2>/dev/null || echo 0)
echo "════ QUERY: \"$QUERY\"  (project: $(basename "$PROJ")) ════"
OUT=$(timeout 120 claude -p "$QUERY" --plugin-dir "$CTX" 2>&1) || true

echo "── DAEMON (what retrieved + scores) ──"
tail -n +"$((BEFORE+1))" "$LOG" 2>/dev/null | grep -iE "retriev|no retrieval" | sed 's/^/  /' || echo "  (no new daemon line)"
echo "── CLAUDE RESPONSE (tail — footer + how it used context) ──"
echo "$OUT" | tail -6 | sed 's/^/  /'
echo "════════════════════════════════════════════════════════"
