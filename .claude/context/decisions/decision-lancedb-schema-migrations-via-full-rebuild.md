---
name: lancedb-schema-migrations-via-full-rebuild
description: >-
  LanceDB schema changes (e.g. tags as list column) should go via full
  dump+recreate, not dual-read migration, given corpus rebuild is cheap — still
  needs a MIGRATIONS.md entry
metadata:
  type: decision
  tags:
    - lancedb
    - migration
    - schema
    - tags
---

## Decision

When a LanceDB schema change is needed (e.g. converting `tags` from a comma-joined string to a real `List<Utf8>` column, see `implementation/lancedb-api-surface.md` and [issue #96](https://github.com/equiphealth/claude-contextus/issues/96)), the **runtime migration mechanism** is a full drop-and-recreate of the LanceDB table from source files, not an in-place dual-read/dual-write migration — and critically, **there is no corpus to convert**. The LanceDB table is a derived index; the source of truth is the `.claude/context/**/*.md` frontmatter (and `docs/`), which is untouched by the schema change. Only the embedding layer (e.g. `buildRows` in `lib/embedding/file-to-rows.ts`) needs to change how it maps source frontmatter to row shape; then the table gets dropped and fully re-embedded from those same unchanged files.

**This does NOT mean skipping the project's migration bookkeeping.** `reference/reference-migration-system.md` requires five coordinated files for any breaking schema/DB-layout/config change: `migrations/MIGRATIONS.md` entry, detection logic in `scripts/upgrade-detect.ts`, a migration script (or inline command if none is needed), `skills/contextus-upgrade/SKILL.md` update, and a `package.json` version bump. A "full rebuild" migration still needs all of these — the simplification is in the *runtime steps* (one rebuild call instead of custom dual-read code), not in skipping detection/versioning/upgrade-skill entries. Detection for a full-rebuild migration can be purely version-based (`compareSemver(dataVersion, 'X.Y.Z') < 0`) rather than probing actual table schema, since re-running the rebuild is always safe.

**Why full rebuild over dual-read:** `pnpm embed`/the daemon's auto-rebuild already re-embeds the entire corpus from source files cheaply and quickly — there is no expensive external embedding cost to avoid, and no large row count to preserve incrementally (this is a local, per-project corpus, not a production-scale table). Given that, a full rebuild is simpler and safer than writing code to handle two row shapes (old comma-string rows vs new list rows) coexisting in `upsertRows`/`reconcile-run.ts`/`getContentHashes` during a rolling migration — especially given this project has already fought several distinct LanceDB cold-start/race bugs this week (`gotchas/gotcha-lancedb-cold-start-read-after-write-race-family.md`) from code paths that *assumed* simple table states. Adding a third row-shape state (mixed old/new) during a migration window multiplies that surface for a bug that's been expensive to fix once already.

**How to apply:** For the tags-as-list-column change specifically: (1) change `buildRows` to emit `tags` as a real array instead of `ctx.tags.join(',')` — no corpus/frontmatter changes needed, tags are already a YAML list on disk; (2) add the standard migration entry (MIGRATIONS.md, upgrade-detect.ts, upgrade skill, version bump) with Steps = "drop and fully re-embed via the existing `createTable(rows, { replace: true })` path in `reconcile-run.ts`" rather than a new custom script. Applies generally to future LanceDB schema changes in this project unless/until the corpus grows large enough that a full rebuild becomes genuinely expensive (not the case today).

## Related bug surfaced during this discussion

The current comma-joined tag storage (`tags: ctx.tags.join(',')` in `file-to-rows.ts:87`) has a latent corruption bug: nothing enforces "no commas inside a tag value," so a tag containing a literal comma would silently split into multiple tags on read, with no error. The tag rules in `dev/CATEGORIES_AND_TAGS.md` forbid compound tags but don't explicitly forbid commas within a tag — worth fixing as part of the same list-column migration (a real array column makes the bug moot entirely, since there's no join/split round-trip).

## Tracking

Filed as [GitHub issue #96](https://github.com/equiphealth/claude-contextus/issues/96).

