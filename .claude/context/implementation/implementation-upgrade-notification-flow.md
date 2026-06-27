---
name: upgrade-notification-flow
description: Automatic upgrade notification flow when plugin is updated via marketplace
metadata:
  type: implementation
  tags: ["versioning", "hooks", "SessionStart"]
---

# Upgrade Notification Flow

When a user updates the contextus plugin via `/plugins update contextus`, the next session automatically notifies them if migration is needed.

## How It Works

1. User runs `/plugins update contextus` → new version installed (package.json updated)
2. Next SessionStart hook runs:
   - Reads `~/.contextus/version.json` (data schema version — what migrations have been applied)
   - Reads `package.json` version (installed code version)
   - If versions differ, checks `migrations/MIGRATIONS.md` for entries between them
3. Hook shows one of two messages:
   - "run /contextus-upgrade to migrate (breaking changes)" — if MIGRATIONS.md has entries
   - "updated to X.Y.Z" — if no breaking changes (code-only release)
4. User runs `/contextus-upgrade` → performs migration + stamps version.json
5. Next SessionStart → versions match, no notification

## Key Files

- `~/.contextus/version.json` — Data schema version (what's been migrated)
- `package.json` version — Installed code version
- `migrations/MIGRATIONS.md` — Registry of breaking changes
- `scripts/lib/daemon-control.js` → `checkUpgradeNeeded()` — Detection logic
- `scripts/session-start-hook.js` — Notification display

## Version Comparison Logic

The `checkUpgradeNeeded()` function:
1. Compares data version vs installed version (SemVer comparison)
2. Parses MIGRATIONS.md for `## X.Y.Z` headers
3. For each migration version:
   - Is it AFTER data version? (user hasn't seen it yet)
   - Is it BEFORE OR EQUAL TO installed version? (code supports it)
   - If both: breaking changes detected → user needs to run `/contextus-upgrade`

## Why This Works

- No `PluginUpdate` hook exists in Claude Code, but we don't need one
- SessionStart hook runs on every session, so version mismatch is detected immediately
- `version.json` is ONLY updated by `/contextus-upgrade`, not automatically
- This creates a persistent "you need to migrate" notification until user acts
- Non-blocking: if user doesn't upgrade, context injection gracefully degrades

## Example Flow

```
User on 0.11.0:
  ~/.contextus/version.json → { "version": "0.11.0" }
  package.json → "0.11.0"
  SessionStart → no notification

User runs /plugins update contextus:
  package.json → "0.12.0"
  ~/.contextus/version.json → still "0.11.0"
  
Next session:
  SessionStart checks:
    - Data version: 0.11.0
    - Installed version: 0.12.0
    - Check MIGRATIONS.md: finds ## 0.12.0 entry
    - Result: hasBreakingChanges = true
  
  Shows: "contextus: run /contextus-upgrade to migrate (breaking changes)"

User runs /contextus-upgrade:
  - Performs migration steps
  - Step 4: stamps version.json → { "version": "0.12.0" }
  
Next session:
  SessionStart checks:
    - Data version: 0.12.0
    - Installed version: 0.12.0
    - Result: needed = false
  
  No notification shown
```

## Code-Only Releases

If a release has NO breaking changes (e.g., 0.12.0 → 0.12.1 for bug fixes):
- MIGRATIONS.md has NO new entries
- checkUpgradeNeeded() returns `hasBreakingChanges: false`
- SessionStart shows: "contextus: updated to 0.12.1"
- No action required — daemon will auto-restart on next session

