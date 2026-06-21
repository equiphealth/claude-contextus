# Migrations Registry

Each entry describes a breaking change that requires data/config migration when
upgrading from a version below the entry's `version` to one at or above it.

The upgrade skill reads this file, compares the user's `~/.contextus/version.json`
against the current `package.json` version, and runs only the migrations in between.

## Format

Each migration is an H2 with the version it was introduced in, a description of
what changed, and a `steps` section with the concrete actions the upgrade skill
should perform.

---

## 0.8.0 — Unified Database & Workspaces

**What changed:**
- Single shared LanceDB at `~/.contextus/data/contextus.lance` replaces per-project DBs
- Every row has a `project` column (sha256 hash of the absolute path)
- `linkedProjects` config replaced by workspace files (`~/.contextus/workspaces/`)
- `linkedContext` source label replaced by `siblingContext` (workspace-scoped queries)
- `deleteBySource()` removed; `deleteByProject()` added
- `resolveDBPath()` returns a fixed path (ignores project param)

**Detection:**
- Per-project DB dirs exist at `~/.contextus/data/<name>/contextus.lance/`
- `linkedProjects` key in any `~/.contextus/data/<name>/config.json`
- Rows without a `project` column in an existing corpus

**Steps:**
1. Stop the daemon (holds memoized connection to old DB path; respawns on next session)
2. Delete old per-project DB directories and `__manifest` artifacts (`~/.contextus/data/<name>/`)
3. Convert `linkedProjects` config entries → workspace JSONC files
4. Remove `linkedProjects` key from tier-2 config files
5. Re-embed the current project (rows now get `project` column stamped)
6. Other projects re-embed on their next session start (reconcile detects empty corpus)

**Scripts:**
- `pnpm upgrade-detect` — reports what needs migrating (JSON output)
- `pnpm migrate-workspaces` — converts linked projects → workspaces
- `pnpm embed` — re-embeds with unified DB + project column

**Rollback:** Not needed (no other users; re-embed is the forward path).

---

<!-- TEMPLATE for future migrations:

## X.Y.Z — Short Title

**What changed:**
- Bullet list of breaking changes

**Detection:**
- How to tell if this migration is needed

**Steps:**
1. Ordered actions to perform

**Scripts:**
- Commands that implement the steps

**Rollback:** How to undo if needed (or "not applicable").

-->
