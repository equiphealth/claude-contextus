---
name: npm-not-used
description: contextus is NOT published to npm — marketplace install git-clones the repo; npm would produce a non-functional package
metadata:
  type: decision
  tags:
    - packaging
    - releases
    - distribution
    - npm
---

**Decision** (2026-06-15): do **not** publish contextus to npm. The `publish-npm` job
was deleted from `release.yml`.

**Why:** the marketplace install **git-clones the repo** (Claude Code reads
`.claude-plugin/marketplace.json`, plugin `source: "."`) — npm is never consulted
anywhere in the install chain. A published npm package would be a non-functional
`node_modules/claude-contextus/` folder: no hooks, no daemon, no plugin activation. npm
only matters for libraries other code imports, global CLIs, or version-pulled deps —
none of which contextus is (it builds native deps on-target by design).

**What stays:** GitHub Releases (on `v*.*.*` tags) — useful as the tag target for
version-pinned installs + changelog, NOT as a download source (the clone uses committed
`dist/`). See `decision-daemon-from-dist`.
