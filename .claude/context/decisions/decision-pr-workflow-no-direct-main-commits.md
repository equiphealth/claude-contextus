---
name: pr-workflow-no-direct-main-commits
description: Never commit directly to main — always use feature branches and PRs, even for small fixes
metadata:
  type: decision
  tags: ["workflow", "git", "pr-process"]
---

# Decision: Always Use PRs, Never Direct Main Commits

## Policy

**Never push commits directly to `main`** — all changes, no matter how small, must go through a feature branch and pull request.

## Rationale

1. **Review opportunity** — Even obvious fixes can have unintended side effects
2. **CI validation** — PRs run tests/checks before merging
3. **Documentation** — PR descriptions explain *why* changes were made
4. **Reversibility** — Easy to revert a PR vs cherry-picking commits
5. **Team visibility** — Others see what's changing and can comment
6. **Audit trail** — GitHub tracks PR approvals and discussions

## Workflow

### When working on multiple features in one session:

1. **Complete feature A**: Push branch, create PR
2. **Merge PR A** (or wait for review if needed)
3. **Pull latest main**: `git checkout main && git pull`
4. **Start feature B**: `git checkout -b feat/feature-b`
5. **Commit and push**: Create PR for feature B

Do NOT:
- ❌ Commit multiple unrelated changes to main
- ❌ Push directly to main "because it's small"
- ❌ Skip PR creation "because it's just docs"

### Branch naming:

- `feat/<description>` — New features
- `fix/<description>` — Bug fixes
- `docs/<description>` — Documentation only
- `chore/<description>` — Tooling, dependencies, etc.

## Exceptions

**None.** Even for:
- Typo fixes
- README updates
- Version bumps
- Hotfixes (create PR, merge immediately, but still have the PR record)

## Implementation Notes

- Consider branch protection rules on GitHub to enforce this
- Use `--force-with-lease` instead of `-f` when force-pushing (safer)
- Squash-merge PRs to keep main history clean

## Example: Today's Mistake

**What happened:**
- PR #29 merged (skill optimization)
- Today's source exclude fix was already in PR #29
- Instead of creating a new PR for additional docs, committed directly to main

**What should have happened:**
1. Merge PR #29
2. `git checkout -b docs/context-updates`
3. Commit context pattern updates
4. Push and create PR #30
5. Merge PR #30

**Lesson:** Even "just updating context files" should go through a PR. Context changes affect future sessions and should be reviewable.
