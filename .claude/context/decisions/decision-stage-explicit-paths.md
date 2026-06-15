---
name: stage-explicit-paths
description: Never `git add -A` — stage only the explicit paths you changed, so unrelated working-tree edits don't get swept into the commit
metadata:
  type: decision
  tags: [git, commit, hygiene]
---

Don't use `git add -A` (or `git add .`) when committing. Stage the explicit paths you actually changed — `git add lib/ daemon/ scripts/*.ts tests/*.ts docs/BUILD_PROMPTS.md`, etc.

**Why:** The user often has their own separate, intentional changes sitting in the working tree (e.g. they disabled `.github/workflows/*.yml` by hand). A blanket `git add -A` swept those into a docs commit they had nothing to do with, and it had to be unpicked with `git reset --soft`. The working tree is shared; not everything in it is mine to commit.

**How to apply:** Before committing, `git status --short` to see what's there. Stage by explicit path (the files this task touched), confirm `git diff --cached --stat` shows only those, then commit. If something unexpected shows up unstaged, leave it — it's probably the user's separate work — and mention it rather than absorbing it.

**Related**: [[selfdoc-build-practice]]
