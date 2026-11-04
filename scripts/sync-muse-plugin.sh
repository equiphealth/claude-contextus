#!/bin/bash
# Dev-loop helper: refresh the installed Muse plugin from a clean HEAD archive.
# `muse plugins update` refreshes the cache in place and preserves hook
# approval (verified 2026-10-29) — no remove/install/approve cycle needed.
# Usage: ./scripts/sync-muse-plugin.sh [/tmp/ctx-bundle]
# NOTE: the bundle dir is scratch staging only — `muse plugins update`
# refreshes the installed plugin from its registered source in place
# (verified 2026-10-29: preserves hook approval). The bundle itself is
# never executed; it exists so the refresh has a clean-HEAD tree to read.
set -e
BUNDLE="${1:-/tmp/ctx-bundle}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"
git -C "$ROOT" archive HEAD | tar -x -C "$BUNDLE"
muse plugins update contextus
muse plugins inspect contextus | grep -E "trusted_enabled|review_needed"
