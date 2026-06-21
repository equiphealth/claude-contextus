---
name: contextus-upgrade
description: Run after installing/updating contextus — migrates config, database, and linked projects to match the current version.
---

# Contextus Upgrade

Version-aware migration runner. Compares the user's data schema version
(`~/.contextus/version.json`) against the installed code version, then applies
only the migrations in between. Safe to re-run (idempotent).

## When to Use

- After updating the contextus plugin (`git pull` or marketplace update)
- When session-start reports a version mismatch
- When you see errors about missing columns, old DB paths, or config format
- Proactively: `pnpm upgrade-detect` shows if anything is pending

## Usage

```bash
/contextus-upgrade              # detect + apply (confirms before each step)
/contextus-upgrade --dry-run    # show what would change without applying
/contextus-upgrade --force      # skip confirmations, apply immediately
```

## Implementation

### Step 1: Detect

Run the detection script and parse its output:

```bash
TSX=~/src/claude-contextus/node_modules/.bin/tsx
$TSX ~/src/claude-contextus/scripts/upgrade-detect.ts
```

This outputs JSON with:
- `dataVersion` — what the user's data is migrated to
- `installedVersion` — what the code expects
- `needsUpgrade` — boolean
- `migrations[]` — list of pending migrations (version + title + reason)
- `details` — specifics (per-project DBs found, linked configs, etc.)

If `needsUpgrade` is false, report "Already up to date" and stop.

### Step 2: Present Plan

Show the user what migrations will run:

```
contextus-upgrade: 1 migration(s) pending

  Data version:      0.7.0
  Installed version: 0.8.0

  Migrations to apply:
    [0.8.0] Unified Database & Workspaces
            2 per-project DB(s) need consolidation

  See migrations/MIGRATIONS.md for full details.

Proceed? (--dry-run stops here)
```

### Step 3: Apply Migrations (in version order)

Read `migrations/MIGRATIONS.md` for the steps of each pending migration. Apply
them in ascending version order. Each migration entry in that file has:
- **Detection** — how to tell if it's needed
- **Steps** — ordered actions
- **Scripts** — commands that implement the steps

For 0.8.0 (Unified DB & Workspaces):

```bash
# 1. Convert linkedProjects → workspaces
$TSX ~/src/claude-contextus/scripts/migrate-workspaces.ts

# 2. Delete old per-project DBs
rm -rf ~/.contextus/data/*/contextus.lance
rm -rf ~/.contextus/data/*/contextus.meta.json
find ~/.contextus/data -maxdepth 1 -type d -empty -delete 2>/dev/null

# 3. Re-embed (rebuilds with project column in unified DB)
cd <project-dir>
$TSX ~/src/claude-contextus/scripts/embed-contexts.ts
```

### Step 4: Stamp Version

After all migrations succeed, stamp the data version:

```bash
$TSX -e "
import { writeVersionState, getInstalledVersion } from './lib/version.js';
writeVersionState(getInstalledVersion());
console.log('Stamped version:', getInstalledVersion());
"
```

Or use the helper directly in Node:

```typescript
import { writeVersionState, getInstalledVersion } from '../lib/version.js';
writeVersionState(getInstalledVersion());
```

### Step 5: Verify

```bash
# Version check
$TSX ~/src/claude-contextus/scripts/upgrade-detect.ts
# Should show needsUpgrade: false

# Health check
curl -s http://127.0.0.1:37800/health | python3 -m json.tool
```

## How Versioning Works

| File | Purpose |
|------|---------|
| `package.json` → `version` | Installed code version (what the plugin expects) |
| `~/.contextus/version.json` | Data schema version (what migrations have been applied) |
| `migrations/MIGRATIONS.md` | Registry of all breaking changes + their migration steps |

The upgrade skill computes: `pending = migrations WHERE version > dataVersion AND version <= installedVersion`.

On fresh install (no version.json), `dataVersion` defaults to `0.0.0` — all
migrations run. After a successful upgrade, version.json is stamped to match
package.json, so re-running is a no-op.

## Adding New Migrations

When making a breaking change:

1. Add an entry to `migrations/MIGRATIONS.md` under the version that introduces it
2. Add detection logic to `scripts/upgrade-detect.ts` (in the `detectMigrations` function)
3. Write any needed scripts in `scripts/`
4. Update this skill's Step 3 with the new migration's commands
5. Bump `package.json` version to match

## Related

- `migrations/MIGRATIONS.md` — full registry of all versioned migrations
- `/contextus-setup` — first-time setup (includes initial embed)
- `/rebuild-embeddings` — re-embed without version migration
- `/context-status` — health dashboard (verify after upgrade)
