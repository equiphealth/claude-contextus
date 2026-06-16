# Versioning

**Decision (2026-06-15).** Two things were getting conflated: the **roadmap phase**
("v1.1 packaging") and the **release version** in the manifests. They are now
decoupled.

## The rule

- **Manifests follow SemVer, staying in `0.x` until a verified public 1.0.** All three
  version fields move together:
  - `package.json` → `version`
  - `plugin.json` → `version` (runtime config file)
  - `.claude-plugin/plugin.json` → `version` (the plugin manifest)
- **"v1.0 / v1.1 / v2" are roadmap labels, NOT the file version.** They name phases in
  docs + memory (e.g. `next-v1-1-packaging`), and do not dictate the SemVer number.

## Why `0.x`, not `1.1.0`

A `1.0.0` would claim "stable, others can install and use it." As of this milestone
that isn't true — the work is dogfooded via `--plugin-dir`, but the **marketplace
install is unverified on a clean machine** (see the smoke-test todo + PACKAGING.md). So
the honest number stays pre-1.0.

**1.0.0 is reserved for:** the GitHub-marketplace install is smoke-tested end-to-end and
someone who isn't us can install + use contextus. Until then we bump `0.x`.

## What this milestone is

- `0.1.0` → `0.2.0` — the Docs & DX + packaging-mechanics milestone (compiled `dist/`,
  drop runtime tsx, `marketplace.json`, SessionStart dep-install, user docs). More than
  a patch; not yet a stable public release.

## Bumping

Keep the three version fields in lockstep. Minor (`0.x+1.0`) for a feature/milestone,
patch (`0.x.y+1`) for fixes. The `release.yml` workflow tags on `v*.*.*` — see
`[[tagged-releases-consideration]]` before relying on it (it's stale).
