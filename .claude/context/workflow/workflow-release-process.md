---
name: release-process
description: How versioned releases work — version bump in package.json triggers release on merge to main
metadata:
  type: reference
  tags: [release, ci, workflow]
---

# Release Process

## How it works

The release workflow (`.github/workflows/release.yml`) runs on every push to `main`. It creates a **versioned release** when `package.json` version doesn't already have a matching `v{version}` tag.

```
merge to main → CI reads package.json version → tag exists? → NO → create release
```

## What triggers a release

A version bump in `package.json`. The workflow compares `HEAD` vs `HEAD^` — if the version string changed, a versioned release is created. No manual tagging needed.

Escape hatch: `workflow_dispatch` with `force: true` creates a release even without a version change.

## Starting a new feature

Always create a feature branch before implementation work begins:
```bash
git checkout -b feat/<feature-name>
```

Push early, open a draft PR if the work spans sessions. This keeps main clean and gives a place to track incremental progress.

## PR checklist for release-worthy changes

When a PR includes features/fixes that warrant a release:

1. **Create a feature branch** (`feat/`, `fix/`, `chore/`)
2. **Bump `package.json` version** — SemVer, stay 0.x until public 1.0
3. **Add CHANGELOG.md section** — must be `## [X.Y.Z]` format (see gotcha-changelog-heading-format)
4. Version bump + changelog go in the same PR as the code changes

If you forget the bump, the merge updates `latest` (pre-release) but creates no versioned release. You'll need a follow-up commit to main with just the bump.

## Release body content

The workflow extracts the matching `## [VERSION]` section from CHANGELOG.md for the GitHub release body. Falls back to git commit list if no matching section found.

## What gets released

- `claude-contextus-plugin.tar.gz` — built artifact (dist/ + scripts/ + skills/ + hooks/ + templates/ + source fallback)
- Versioned release: `v0.6.0` (permanent, from package.json)
- Latest pre-release: `latest` tag (updated on every main push, always current)
