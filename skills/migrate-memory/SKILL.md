---
name: migrate-memory
description: Convert legacy .claude/memory/ slug files into .claude/context/ prefix-scoped, typed, tagged files (dry-run by default, idempotent, verify-before-embed)
---

# Migrate Memory → Context

One-time-ish cleanup that moves the canonical knowledge store from `.claude/memory/`
(named-slug files + `MEMORY.md` index) to `.claude/context/` (prefix-scoped folders,
`metadata.type` + `tags`). See `docs/IMPLEMENTATION_ESTIMATE.md` → "Memory → Context
Migration" and the `memory-to-context-migration` decision.

## When to Use

After the embedding pipeline + daemon exist (Phases 0–2) — there's nothing to
re-embed migrated files into before then. Run it once the spine is proven, **not**
on a whim mid-build (migrating early just creates orphaned files).

## Safety Contract

This skill moves truth into the **injected corpus**, so it is deliberately careful:

- **Dry-run by default** — `pnpm migrate-memory` prints the plan (each `slug → prefix-name`,
  inferred `type`, seeded `tags`) and writes **nothing**.
- **Idempotent** — a target file that already exists is **skipped**, never clobbered. Safe
  to re-run if interrupted; no half-converted corpus.
- **Verify-before-embed** — it never auto-embeds. After `--apply` it prints the exact
  `pnpm run embed` command for you to run *after* eyeballing the converted files
  (per `selfdoc-build-practice`: verify before it hardens into the corpus).

## Usage

```bash
# 1. Dry-run — see exactly what would happen (no writes)
pnpm migrate-memory

# 2. Apply — write the converted files into .claude/context/ (still no embed)
pnpm migrate-memory --apply

# 3. Apply + repoint plugin.json's projectMemory source at .claude/context
pnpm migrate-memory --apply --repoint

# 4. Verify the converted files look right, THEN re-embed
pnpm run embed
```

## What It Does

| Step | Detail |
|---|---|
| **Rename** | `decision_build_execution_cadence.md` → `decisions/decision-build-execution-cadence.md` |
| **Type** | Inferred from frontmatter `type`, else the filename prefix; filename head is forced to equal the type so the prefix↔type gate + re-ranker `typeBoost` both fire |
| **Tags** | Existing `tags` preserved; **never fabricated** (a file with no tags migrates tagless — tags are inert until v2 CAE anyway) |
| **Frontmatter** | Rewritten to the nested target schema (`metadata: { type, tags }`) |
| **Folder** | Per-type (`decisions/`, `feedback/`, `gotchas/`, …) |
| **plugin.json** | `--repoint` flips `config.sources.projectMemory.path` to `.claude/context` (idempotent) |

## How Mapping Works

Pure logic in `lib/memory-migrate.ts` (`planFile` / `planMigration`), so the
slug→prefix rename, type inference, and tag handling are unit-tested
(`tests/memory-migrate.test.ts`) independent of disk I/O. The orchestration +
safety (dry-run, idempotency, repoint, verify-before-embed) live in
`scripts/migrate-memory.ts`.

## Related

- `/create-context` — author a new context file directly
- `/rebuild-embeddings` — full corpus re-embed
- `docs/CATEGORIES_AND_TAGS.md` — the category/tag vocabulary the targets use
