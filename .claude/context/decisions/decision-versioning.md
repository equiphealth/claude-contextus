---
name: versioning
description: Manifests follow SemVer staying 0.x until a verified public 1.0; "v1.1/v2" are roadmap labels, not file versions
metadata:
  type: decision
  tags:
    - versioning
    - releases
    - semver
    - packaging
---

**Decision** (2026-06-15): the roadmap phase and the release version are decoupled.

- **Manifests follow SemVer, stay `0.x` until a verified public 1.0.** Three version
  fields move in lockstep: `package.json`, `plugin.json` (runtime config), and
  `.claude-plugin/plugin.json` (manifest). Now at **0.2.0**.
- **"v1.0 / v1.1 / v2" are roadmap LABELS, not the file version.** The "v1.1 packaging"
  work ships as file version 0.2.0, not 1.1.0.
- **1.0.0 is reserved for:** marketplace install smoke-tested end-to-end + someone who
  isn't us can install and use it. Mechanics are done but the clean-machine install is
  unverified, so the honest number stays pre-1.0.

When bumping: change all three fields together (minor for a milestone, patch for fixes).
Full rationale in `docs/dev/VERSIONING.md`.
