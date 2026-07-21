---
name: pr-completion-checklist
description: Standard PR completion workflow: changelog, version bump (all 3 manifests), then merge
metadata:
  type: reference
  tags: ["workflow", "release"]
---

# PR Completion Checklist

Before merging any PR in claude-contextus:

## 1. Update CHANGELOG.md

- Add entry under `## [Unreleased]` section
- Create new version section with date: `## [X.Y.Z] - YYYY-MM-DD`
- Categorize changes: Added, Changed, Fixed, Removed, Deprecated, Security
- Use past tense ("Fixed", not "Fix")
- Be specific about what changed and why it matters

## 2. Bump version in ALL THREE manifests

This project ships **three** files carrying a `version` field, and they must stay in lockstep:

- `package.json` — npm/pnpm package version
- `.claude-plugin/plugin.json` — plugin install manifest (`plugin.jsonc` has a comment: "Keep version in sync with the manifest")
- `plugin.jsonc` — runtime config, same version field

**Gotcha (observed 2026-07-20/21):** PR #32 bumped only `package.json` (0.14.0 → 0.15.0), missing both plugin manifests, which stayed at 0.14.0. PR #33 caught and fixed the drift by bumping all three to 0.16.0 in the same commit. Since this is easy to miss, grep before pushing:

```bash
grep -h '"version"' package.json .claude-plugin/plugin.json plugin.jsonc
```

All three lines should show the same version string.

- Update `version` field to match CHANGELOG entry
- Follows SemVer (0.x until verified public 1.0)
- Patch: bug fixes, docs
- Minor: new features, non-breaking changes
- Major: breaking changes (rare in 0.x)

## 3. Commit and push

```bash
git add CHANGELOG.md package.json .claude-plugin/plugin.json plugin.jsonc
git commit -m "chore: bump version to X.Y.Z"
git push
```

## 4. Verify CI passes

```bash
gh pr checks <pr-number>
```

## 5. Merge

- Squash merge to keep main history clean
- Default merge message usually fine (includes all commits)
- Delete branch after merge

## Related

- See `.claude/memory/versioning-scheme.md` for SemVer policy
- See `decisions/decision-pr-workflow-no-direct-main-commits.md` for PR-only policy
