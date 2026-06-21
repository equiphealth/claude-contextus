---
name: changelog-incremental-updates
description: Update CHANGELOG.md incrementally during development using Unreleased section, not at PR time
metadata:
  type: workflow
  tags: [changelog, workflow, release, documentation]
---

# CHANGELOG incremental updates

**Pattern**: Add changes to `## [Unreleased]` as you implement them, not at PR merge time.

## How it works

CHANGELOG.md maintains an `## [Unreleased]` section at the top with three subsections:
- `### Added` — new features, endpoints, config options, skills
- `### Changed` — modifications to existing behavior
- `### Fixed` — bug fixes

**During development**: When you complete a meaningful change (not every commit, but anything worth mentioning in release notes), add a bullet to the appropriate subsection.

**At PR merge time** (version bump): Rename `## [Unreleased]` → `## [X.Y.Z] - YYYY-MM-DD`, then add a fresh `## [Unreleased]` section above it for the next cycle.

## Why

Reconstructing all changes from git log at PR time is error-prone and time-consuming. Incremental updates capture context while it's fresh and turn the release checklist into a mechanical rename.

## When to add entries

- ✅ New user-visible features (skills, config fields, endpoints)
- ✅ Breaking changes or behavior modifications
- ✅ Bug fixes that affected real usage
- ✅ Dependency upgrades with user impact (security, compatibility)
- ❌ Internal refactors with no behavior change
- ❌ Test-only changes
- ❌ Documentation-only changes (unless they materially improve onboarding)

## Example flow

```markdown
## [Unreleased]

### Added
- **Workspace support**: All projects share one DB at ~/.contextus/data/contextus.lance
- **Version-aware migrations**: schema_version tracking with auto-upgrade on daemon start

### Changed
- `handleReconcile` now requires projectId hash instead of project name

### Fixed
```

Then at release (bumping to 0.8.0):

```markdown
## [Unreleased]

### Added

### Changed

### Fixed

## [0.8.0] - 2026-06-21

### Added
- **Workspace support**: All projects share one DB at ~/.contextus/data/contextus.lance
- **Version-aware migrations**: schema_version tracking with auto-upgrade on daemon start

### Changed
- `handleReconcile` now requires projectId hash instead of project name

### Fixed
```

## Related

- [[pr-merge-checklist]] — the full pre-merge gate (version bump + CHANGELOG rename)
- [[changelog-heading-format]] — exact `## [X.Y.Z]` format required for release workflow grep
