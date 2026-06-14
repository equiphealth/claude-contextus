---
name: design-scoping-v1-v2
description: v1/v2 scoping for the CAE, categories/tags, self-documentation, and removal designs
metadata:
  type: decision
---

**Decision** (2026-06-14): Four design docs landed after the implementation estimate; their v1/v2 placement is settled — do not re-litigate mid-build.

| Design | v1 scope | Deferred to v2 |
|---|---|---|
| **CAE** (LLM-per-candidate applicability gate) | **None.** v1 gate stays cheap similarity floor + re-ranker — no hot-path LLM, preserves zero-latency proactive injection. | Full CAE: `retrieve → re-rank → floor → CAE → inject`. Becomes the "advanced re-ranking" item. |
| **Categories & tags** | Author `metadata.type` + `tags` in frontmatter from day one; re-ranker reads `type` for `typeBoost`. | Tags are **inert until CAE consumes them** in v2. |
| **Self-documentation (Layer 1)** | `/introspect` endpoint only, feeding `/context-status`. | `generate-docs` + 7 auto-doc files, under `docs/generated/` to avoid clobbering hand-written specs. |
| **Removal / governance** | Concept only + **log floor rejection signals** (groundwork — can't backfill). | Soft/hard/replacement removal mechanisms. |

**Net effect on the spine: none.** Phases 0–2 unchanged. v1 only gains light touches: frontmatter schema (Phase 1), rejection logging (Phase 2), `/introspect` (Phase 5).

**Self-doc-during-build stance** (SELF_DOCUMENTATION.md §4.5): context files I author *become the injected corpus*, so **verify before embedding** — a wrong pattern is worse than no pattern. One ledger, not four: Layer 3 = curated patterns, commits = rationale, claude-mem = raw narration, `/introspect` = state. Layer 2 demoted to ephemeral scratch buffer.

**Still open** (parked in v2 backlog): who authors `canonical`/`deprecated`/`manually-promoted` overrides; whether CAE batches candidates; confirm floor short-circuits before any CAE call.

Docs: `docs/CONTEXT_APPLICABILITY_EVALUATOR.md`, `docs/CATEGORIES_AND_TAGS.md`, `docs/SELF_DOCUMENTATION.md`, `docs/IMPLEMENTATION_ESTIMATE.md`.

**Related**: [[build-execution-cadence]], [[selfdoc-build-practice]]
