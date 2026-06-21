---
name: migration-system
description: How to add a breaking change to contextus — the relationship between MIGRATIONS.md, lib/version.ts, upgrade-detect.ts, and the upgrade skill
metadata:
  type: reference
  tags: [versioning, migration, upgrade]
---

# Migration System Architecture

When making a breaking change to contextus (schema, DB layout, config format), five files must be updated in coordination:

## Files involved

| File | Role |
|------|------|
| `migrations/MIGRATIONS.md` | Registry of all breaking changes (version, detection, steps, scripts) |
| `lib/version.ts` | Reads/writes `~/.contextus/version.json`, semver comparison |
| `scripts/upgrade-detect.ts` | Detects what migrations are pending (outputs JSON) |
| `skills/contextus-upgrade/SKILL.md` | User-facing skill that runs the migration |
| `package.json` | Code version (what the data should match after upgrade) |

## Adding a new breaking change

1. **Add entry to `migrations/MIGRATIONS.md`** under the new version (H2 heading with version + title, then What changed / Detection / Steps / Scripts / Rollback sections)
2. **Add detection logic** in `scripts/upgrade-detect.ts` → `detectMigrations()` function (check `compareSemver(dataVersion, 'X.Y.Z') < 0`, then probe for the old state)
3. **Write migration script(s)** in `scripts/` if automated steps are needed
4. **Update the upgrade skill** (`skills/contextus-upgrade/SKILL.md` Step 3) with the new migration's commands
5. **Bump `package.json` version** to the new version number

## Version tracking

- `~/.contextus/version.json` — data schema version (what migrations have been applied)
- `package.json` version — code version (what the plugin expects)
- Upgrade is needed when `data < installed`
- Fresh install has no version.json → defaults to `0.0.0` → all migrations run
- After successful upgrade, version.json is stamped to match package.json

## Key functions in lib/version.ts

- `compareSemver(a, b)` — returns -1/0/1
- `readVersionState()` — reads version.json (returns `{version: '0.0.0', migratedAt: ''}` if missing)
- `writeVersionState(version)` — stamps after successful migration
- `getInstalledVersion()` — reads package.json
- `needsUpgrade()` — `compareSemver(data, installed) < 0`
