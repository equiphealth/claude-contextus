---
name: lib-reorg-plan
description: Planned lib/ reorganization — group ~23 flat files into subdirs as a standalone fresh-session commit; concrete grouping + gate + caveats here
metadata:
  type: project
  tags: [refactor, structure, lib, follow-up]
---

**Context (2026-06-14)**: `lib/` grew to ~23 flat `.ts` files through Phase 5; the user flagged it as disorganized and wants it tidied — but as a **dedicated standalone commit**, not folded into a feature phase. **Do it in a FRESH session**: it's a wide import-graph sweep (rename files, fix imports across daemon + scripts + tests), risky to start with low context (a mid-refactor compaction leaves half-fixed imports + a red build), and a clean session start is the safe rollback point. NOT a numbered build phase — it's cleanup that sits between phases.

**Candidate grouping** (confirm/adjust before moving — cross-cutting files may stay at lib root):
- `embedding/` — embedder, model-resolver
- `storage/` — lance-client, staleness
- `retrieval/` — reranker, dedup, floor, inject-format
- `calibration/` — eval-calibration, eval-model, eval-worker-core, calibration-state, floor-calibration
- `capture/` — novelty, memory-migrate
- `core/` (or leave at lib root) — config, logger, types, context-loader, embed-file, session-state, introspect

**Files that import lib/ and need import-path fixes:** `daemon/server.ts`, `daemon/eval-worker.ts`, all `scripts/*.ts` (embed-contexts, search, calibrate-floor, migrate-memory, fetch-model, verify-lance), all `tests/*.ts`.

**Leave alone:** `scripts/lib/daemon-control.js` is hook-side plain ESM JS, separate from `lib/` — not part of this move. Hooks (`scripts/*.js`) don't import `lib/` (they read `~/.contextus/` state files directly), so they're unaffected.

**Gate before commit:** `pnpm exec tsc --noEmit && pnpm lint && pnpm test` — all 75 tests must stay green. Mechanical-only: no behavior changes, no logic edits.

**Paste-ready kickoff prompt lives in `docs/BUILD_PROMPTS.md`** ("Cleanup — lib/ reorganization" section, after the six build prompts).

**Related**: [[build-prompts-doc]], [[selfdoc-build-practice]]
