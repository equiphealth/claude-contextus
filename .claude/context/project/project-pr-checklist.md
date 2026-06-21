---
name: pr-merge-checklist
description: Feature PRs require version bump, CHANGELOG entry, and README update before merge
metadata:
  type: project
  tags: [pr, release, workflow, versioning]
---

**During development:**

- **Update CHANGELOG.md incrementally** — add changes to `## [Unreleased]` as you implement them (see [[changelog-incremental-updates]])

**Before merging feature PRs:**

1. **Bump version** in ALL THREE version locations (must stay in lockstep):
   - `package.json` → `"version"` field
   - `plugin.jsonc` → `"version"` field (runtime config)
   - `.claude-plugin/plugin.json` → `"version"` field (install manifest)
2. **Finalize CHANGELOG.md** — rename `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD` (must match [[changelog-heading-format]]), then add fresh `## [Unreleased]` section above it
3. **Update README.md** if the feature is user-visible (Features section, config examples, etc.)
4. **Update `docs/FEATURES.md`** if the feature adds/changes capabilities (skills, retrieval, config options, hooks)
5. **Update `docs/API.md`** if daemon endpoints were added/changed (see sync points in reference-api-documentation-structure)
6. **Update `examples/contextus.jsonc`** if new config fields were added (with JSONC comments explaining them)

**Why**: The release workflow auto-creates versioned GitHub releases when it detects a new version in `package.json`. No bump = no release. CHANGELOG is the human-readable record. README is what new users see first. The 3-file version sync is easily missed because `plugin.jsonc` and `.claude-plugin/plugin.json` serve different purposes but both contain a version field.

**How to apply**: When finishing feature work, check these items before the final commit. grep for the old version string across `*.json` and `*.jsonc` to catch all locations. The CI `release.yml` reads version from `package.json` — if unchanged from the last release tag, only `latest` updates (no versioned release).
