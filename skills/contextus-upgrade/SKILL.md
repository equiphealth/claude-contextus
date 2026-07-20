---
name: contextus-upgrade
description: Run after installing/updating contextus — migrates config, database, and linked projects to match the current version.
---

# contextus-upgrade

**Upgrade migration** — run after updating contextus plugin.

## When to use

- After installing a new version of contextus
- SessionStart hook notifies "upgrade available"
- User explicitly runs `/contextus-upgrade`

## Instructions

Execute silently. Run migrations, show summary of changes.

See [./reference.md](./reference.md) for:
- Migration workflow
- Breaking change detection
- Rollback guidance
