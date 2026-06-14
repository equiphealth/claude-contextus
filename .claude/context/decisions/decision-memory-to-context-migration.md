---
name: memory-to-context-migration
description: Migration from .claude/memory/ to .claude/context/; hooks/config still point at memory/
metadata:
  type: decision
---

**Context**: The design moved the canonical knowledge store from `.claude/memory/` to `.claude/context/` (prefix-scoped, tagged, frontmatter per [[design-scoping-v1-v2]] and CATEGORIES_AND_TAGS.md). But the existing plumbing still reads `memory/`.

**What still points at `memory/`** (audited 2026-06-14):
- `plugin.json` → `config.sources.projectMemory.path = ".claude/memory"` (indexFile `MEMORY.md`)
- `plugin.json` → `config.sources.userMemory.path = "~/.claude/memory"`
- The `memory-reminder` skill + UserPromptSubmit hook footer convention reference `MEMORY.md`

Good news: it's **config-driven, not hardcoded in hook JS** — the source path lives in `plugin.json`, so the migration is mostly a config + content move, not a code rewrite. (Hooks dir has no direct `memory/` string refs.)

**Migration is needed at some point**, NOT before the build. Sequence:
1. Build v1 spine (embedding pipeline + daemon) first — there's no `embed-contexts` to re-embed migrated files into until Phase 1–2 exist.
2. Then migrate: move/convert `memory/*.md` (named-slug frontmatter) → `context/*.md` (prefix + `metadata.type` + tags), update `plugin.json` source path, re-embed, retire `memory/` or alias it.

**Also stale in plugin.json** (separate cleanup, flag during Phase 0): `config.chroma` should be `lancedb`; `embedding.model` is `Xenova/all-MiniLM-L6-v2` but DESIGN.md default is nomic; `similarityThreshold: 0.7` is the unvalidated floor.

**Decision**: A dedicated **migration skill** will own the conversion (see TODO below) rather than a one-shot manual move — the memory→context mapping (slug→prefix, type inference, tag seeding) recurs and benefits from being repeatable/idempotent.

**Related**: [[design-scoping-v1-v2]], [[build-execution-cadence]], [[selfdoc-build-practice]]
