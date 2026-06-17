---
name: pr-merge-checklist
description: Feature PRs require version bump, CHANGELOG entry, and README update before merge
metadata:
  type: project
  tags: [pr, release, workflow, versioning]
---

**Before merging feature PRs:**

1. **Bump version** in both `package.json` and `.claude-plugin/plugin.json` (keep in sync)
2. **Update CHANGELOG.md** with a section for the new version (Added/Changed/Fixed)
3. **Update README.md** if the feature is user-visible (Features section, config examples, etc.)

**Why**: The release workflow auto-creates versioned GitHub releases when it detects a new version in `package.json`. No bump = no release. CHANGELOG is the human-readable record. README is what new users see first.

**How to apply**: When finishing feature work, check these 3 items before the final commit. The CI `release.yml` reads version from `package.json` — if unchanged from the last release tag, only `latest` updates (no versioned release).
