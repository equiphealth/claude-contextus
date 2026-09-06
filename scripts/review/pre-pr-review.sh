#!/usr/bin/env sh
#
# Advisory pre-PR code review.
#
#   ./scripts/review/pre-pr-review.sh          # pre-push mode: what's new since the last push
#   ./scripts/review/pre-pr-review.sh --pr     # PR mode: the whole branch vs main
#
# Runs a coding-standards review (Claude Code, headless), streams the report
# to terminal, and saves it to a git-ignored file. Standalone for now — not
# wired into any git hook. Ported from my-equip-mobile's
# scripts/review/pre-pr-review.sh, with two deliberate changes:
#
# 1. Default scope is "what am I about to push right now" — local HEAD vs the
#    branch's upstream tracking ref (`@{u}`), plus currently staged. NOT the
#    whole PR diff every time: re-reviewing already-pushed, already-reviewed
#    commits on every subsequent push is wasted latency and noise. If the
#    branch has no upstream yet (first push), there's nothing to diff against
#    remotely, so this falls back to the full branch-vs-main diff (same as
#    --pr) since everything local is new in that case.
# 2. `--pr` reviews the entire local branch vs main (`$BASE_BRANCH`) —
#    everything the PR would show, regardless of what's already been pushed.
#    Useful once a PR is open and you want the full-diff view. Committed only,
#    no staged — a PR view should reflect committed state.
#
# Both modes deliberately exclude arbitrary unstaged working-tree edits (the
# original my-equip-mobile script computed `git diff HEAD`, which pulls in
# EVERY unstaged file regardless of relevance — harmless in a single-purpose
# working tree, but this repo's working tree routinely carries long-lived
# unrelated dirty state, e.g. a floor-calibration tweak or scratch output
# files, which would get swept into every review's scope alongside the actual
# diff).
#
# Opt out for a single run:    SKIP_AI_REVIEW=1 ./scripts/review/pre-pr-review.sh
# Disable entirely:            git config contextus.aiReview.enabled false
# Stronger model:              git config contextus.aiReview.model opus   (or AI_REVIEW_MODEL=opus)

set -u

MODE="pre-push"
for arg in "$@"; do
  case "$arg" in
    --pr) MODE="pr" ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RESULTS_FILE="${AI_REVIEW_OUTPUT:-$REPO_ROOT/.pre-pr-review.md}"
MODEL="${AI_REVIEW_MODEL:-$(git config --get contextus.aiReview.model 2>/dev/null || echo sonnet)}"
BASE_BRANCH="${AI_REVIEW_BASE:-$(git config --get contextus.aiReview.base 2>/dev/null || echo main)}"

# --- opt-outs -----------------------------------------------------------------
if [ "${SKIP_AI_REVIEW:-0}" = "1" ] || [ "${CI:-false}" = "true" ]; then
  exit 0
fi
if [ "$(git config --get contextus.aiReview.enabled 2>/dev/null || echo true)" = "false" ]; then
  exit 0
fi

# --- require the claude CLI ---------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  printf '\n\033[33m[warn] AI pre-PR review skipped: `claude` CLI not found.\033[0m\n'
  printf '   Install Claude Code, or run `git config contextus.aiReview.enabled false` to silence this.\n\n'
  exit 0
fi

# --- time-box so a hung model can never wedge the terminal --------------------
if command -v timeout >/dev/null 2>&1; then
  RUNNER="timeout 300"
elif command -v gtimeout >/dev/null 2>&1; then
  RUNNER="gtimeout 300"
else
  RUNNER=""
fi

# =============================================================================
# REVIEW
# =============================================================================
git fetch --quiet origin "$BASE_BRANCH" 2>/dev/null || true
BASE="$(git merge-base HEAD "origin/$BASE_BRANCH" 2>/dev/null || git merge-base HEAD "$BASE_BRANCH" 2>/dev/null || echo '')"
if [ -z "$BASE" ]; then
  printf '\n\033[33m[warn] AI pre-PR review skipped: could not find merge-base with %s.\033[0m\n\n' "$BASE_BRANCH"
  exit 0
fi

CURRENT_BRANCH="$(git branch --show-current 2>/dev/null)"
if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  printf '\n\033[33m[review] Skipped: you are on %s. Switch to a feature branch first.\033[0m\n\n' "$CURRENT_BRANCH"
  exit 0
fi

if [ "$MODE" = "pr" ]; then
  # PR mode: the whole local branch vs main. Committed only — a PR view
  # should reflect committed state, not local WIP.
  COMMITTED="$(git diff --name-only "$BASE"...HEAD)"
  CHANGED="$(printf '%s\n' "$COMMITTED" | sort -u | sed '/^$/d')"
  DIFF_DESC="$BASE_BRANCH"
  REVIEW_CMDS="git diff $BASE...HEAD"
else
  # Pre-push mode (default): only what's new since the last push — local HEAD
  # vs the upstream tracking ref — plus currently staged. Falls back to the
  # full branch-vs-base diff when there's no upstream yet (first push; nothing
  # has been pushed remotely, so everything local is new).
  UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')"
  if [ -n "$UPSTREAM" ]; then
    git fetch --quiet origin "$CURRENT_BRANCH" 2>/dev/null || true
    COMMITTED="$(git diff --name-only "$UPSTREAM" HEAD)"
    DIFF_DESC="$UPSTREAM"
    REVIEW_CMDS="git diff $UPSTREAM HEAD"
  else
    COMMITTED="$(git diff --name-only "$BASE"...HEAD)"
    DIFF_DESC="$BASE_BRANCH (no upstream yet — reviewing the full branch)"
    REVIEW_CMDS="git diff $BASE...HEAD"
  fi
  STAGED="$(git diff --cached --name-only)"
  CHANGED="$(printf '%s\n%s' "$COMMITTED" "$STAGED" | sort -u | sed '/^$/d')"
  if [ -n "$STAGED" ]; then
    REVIEW_CMDS="$REVIEW_CMDS ; git diff --cached"
  fi
fi
if [ -z "$CHANGED" ]; then
  printf '\n\033[33m[review] Skipped: no changes vs %s.\033[0m\n\n' "$BASE_BRANCH"
  exit 0
fi

FILE_COUNT="$(echo "$CHANGED" | wc -l | tr -d ' ')"
if [ "$FILE_COUNT" -gt 40 ]; then
  printf '\n\033[33m[warn] Large diff (%s files). Review may be shallow — consider splitting the PR.\033[0m\n' "$FILE_COUNT"
fi

STARTED_AT=$(date +%s)

printf '\n\033[36m[review] Running advisory pre-PR review (Claude Code)...\033[0m\n'
printf '   Mode:   \033[2m%s\033[0m\n' "$([ "$MODE" = "pr" ] && echo 'PR (whole branch vs main)' || echo 'pre-push (new since last push + staged)')"
printf '   Branch: \033[2m%s\033[0m\n' "$CURRENT_BRANCH"
printf '   Diff:   \033[2mvs %s\033[0m\n' "$DIFF_DESC"
printf '   Base:   \033[2m%s\033[0m\n' "$(echo "$BASE" | cut -c1-8)"
printf '   Model:  \033[2m%s\033[0m\n' "$MODEL"
printf '   Files:  \033[2m%s changed\033[0m\n' "$FILE_COUNT"
printf '   Skip:   \033[2mSKIP_AI_REVIEW=1 ./scripts/review/pre-pr-review.sh\033[0m\n'
printf '\n   \033[2mWaiting for Claude...\033[0m\n\n'

# No separate slash-command/instructions files exist in this repo yet (unlike
# my-equip-mobile's .claude/commands/pre-pr-review.md +
# .github/instructions/*.md) — CLAUDE.md already documents this project's
# conventions, so the prompt points straight at it instead of a second file
# that would need to stay in sync.
CHANGED_ONELINE="$(echo "$CHANGED" | tr '\n' ' ')"
PROMPT="Run a pre-PR self-review. Scope: run \`${REVIEW_CMDS}\` to see the actual diff content -- do not review anything outside that scope. Changed files: ${CHANGED_ONELINE}. Read CLAUDE.md first and apply its conventions: the git workflow (feature branch + PR, never direct main commits), the release-worthy-change doc checklist (README.md/docs/FEATURES.md/docs/API.md/docs/dev/V2_ROADMAP.md), JSONC config style, and the 'Core Principles (do not re-litigate)' section. Flag, ranked by severity: (1) correctness bugs, (2) workflow violations, (3) a release-worthy change missing its doc updates, (4) new logic without test coverage, (5) any doc/comment/prose asserting something about the code that isn't actually verified against it (this repo has a recent history of exactly that failure mode -- docs describing config/behavior that had already drifted from what the code does). Print a terminal report: a short verdict line, then findings if any. This is advisory only -- do not modify files, commit, or push."

STARTED_TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

{
  echo "# Pre-PR review"
  echo
  echo "- Generated: ${STARTED_TIMESTAMP}"
  echo "- Mode: ${MODE}"
  echo "- Branch: ${CURRENT_BRANCH}"
  echo "- Diff: ${DIFF_DESC}"
  echo "- Base (${BASE_BRANCH}): ${BASE}"
  echo "- Model: ${MODEL}"
  echo "- Files changed: ${FILE_COUNT}"
  echo
  echo "---"
  echo
} > "$RESULTS_FILE"

# --permission-mode plan keeps it read-only; it can still run git/gh/read/grep.
# Interactive (npm run review): stream to terminal + file.
# Background (future hook): write to file only.
if [ -t 1 ]; then
  $RUNNER claude -p "$PROMPT" --model "$MODEL" --permission-mode plan </dev/null | tee -a "$RESULTS_FILE"
  STATUS=${PIPESTATUS[0]:-0}
else
  $RUNNER claude -p "$PROMPT" --model "$MODEL" --permission-mode plan </dev/null >> "$RESULTS_FILE" 2>/dev/null
  STATUS=$?
fi

ENDED_AT=$(date +%s)
ELAPSED=$((ENDED_AT - STARTED_AT))

if [ "$STATUS" = "124" ]; then
  printf '\n\033[33m[warn] AI review timed out after 5 minutes.\033[0m\n'
elif [ "$STATUS" != "0" ]; then
  printf '\n\033[33m[warn] AI review did not complete (exit %s).\033[0m\n' "$STATUS"
fi

printf '\n---\n\n_Review completed in %ds._\n' "$ELAPSED" >> "$RESULTS_FILE"

if [ -t 1 ]; then
  printf '\n\033[2m──────────────────────────────────────────\033[0m\n'
  printf '\033[2mCompleted in %ds · Report: %s\033[0m\n\n' "$ELAPSED" "$RESULTS_FILE"
else
  # Send macOS notification when running in background (from a future hook)
  VERDICT=$(grep -o 'Verdict: .*' "$RESULTS_FILE" | head -1)
  osascript -e "display notification \"${VERDICT:-Review complete} (${ELAPSED}s)\" with title \"Pre-PR Review\" subtitle \"$CURRENT_BRANCH\"" 2>/dev/null
fi
exit 0
