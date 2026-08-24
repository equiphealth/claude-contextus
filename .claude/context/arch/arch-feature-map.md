---
name: feature-map
description: Consolidated inventory of contextus's ~28 internal features/subsystems with entry points, core files, and purpose — the canonical dev-facing architecture map
metadata:
  type: arch
  tags: ["architecture", "pathfinder", "feature-map"]
---

# Feature Map

Canonical dev-facing inventory of contextus's internal subsystems. Generated via a single Pathfinder Phase 0 subagent run (2026-08-19, ~45.7k tokens, no fan-out) and spot-checked against source (8 file:line claims checked, 7 exact, 1 off-by-one). Companion to `docs/FEATURES.md` (user-facing capability descriptions) — this file is for "where does X live in the code," that one is for "what can contextus do."

## Maintenance

This is one consolidated file, not one-file-per-feature, to keep upkeep cheap. Update it in place when a feature's entry point moves or a new subsystem is added — treat it like any other doc-freshness item in the PR checklist ([[workflow-release-process]], [[implementation-doc-freshness-in-pr-checklist]]). Don't let it silently drift the way README/FEATURES.md did.

## Features

- **Daemon HTTP Server** — `daemon/server.ts:1451` (`requestHandler`), `:1596` (`http.createServer`), `:1695` (`server.listen`). Core: `daemon/server.ts`, `lib/daemon-url.ts`. Long-lived localhost HTTP server exposing `/health`, `/search`, `/capture`, `/delete`, `/query`, `/notify`, `/reconcile`; keeps embedding model warm.

- **Retrieval Pipeline** — `lib/retrieval/pipeline.ts:41` (`processSearchResults`). Core: `pipeline.ts`, `floor.ts`, `dedup.ts`, `reranker.ts`, `inject-format.ts`, `template.ts`, `miss-notice.ts`. Turns raw vector-search results into an injectable context block.

- **Hybrid Search** — `lib/retrieval/hybrid.ts:114` (`hybridKeywordSearch`). Core: `hybrid.ts`, `keyword.ts`, `lib/storage/lance-client.ts:198` (`search`). Fuses vector + BM25 via RRF.

- **Query Expansion** — `lib/retrieval/expand.ts:168` (`expandQuery`). Generates alternate phrasings when score is weak (ollama→bedrock chain).

- **Embedding Pipeline** — `lib/embedding/embedder.ts:137/142` (`embedDocument`/`embedQuery`). Core: `chunker.ts`, `embed-file.ts`, `file-to-rows.ts`, `model-resolver.ts`, `context-loader.ts`. Converts markdown to embedded rows.

- **Multi-Source Loading** — `lib/embedding/sources.ts:97` (`loadAllSources`). Resolves project/user/linked-project sources for corpus building.

- **Vector Storage (LanceDB)** — `lib/storage/lance-client.ts:85` (`getConnection`). CRUD/search over shared LanceDB, per-project scoped via hash column.

- **Reconciliation** — `lib/storage/reconcile.ts:60` (`planReconcile`). Core: `reconcile-run.ts`, `staleness.ts`. Diffs disk vs embedded rows.

- **Calibration** — `lib/calibration/calibration-state.ts:78` (`startCalibration`), `floor-calibration.ts`. Core: `floor-replay.ts`, `floor-report.ts`, `config-write.ts`, `scripts/calibrate-floor.ts`, `scripts/context-calibrate.ts`. Replays queries against candidate floors.

- **Usage Evaluation (Stop hook)** — `hooks/stop-evaluation.js`. Core: `daemon/eval-loop.ts`, `daemon/eval-worker.ts`, `lib/calibration/eval-*.ts`, `parse-footer.ts`. Evaluates whether injected context was used.

- **Context Capture** — `daemon/server.ts:1552` (`/capture` route). Core: `lib/capture/novelty.ts`, `tag-frontmatter.ts`, `prompts/staging-footer.txt`, `awareness-footer.txt`, `scripts/awareness-hook.js`. Staging/propose/silent capture modes.

- **Deletion / Archival** — `daemon/server.ts:1565` (`/delete` route). Core: `skills/context-archive/`, `lib/storage/lance-client.ts:255` (`deleteRows`), `:269` (`deleteByFilename`).

- **CLAUDE.md Stanza Management** — `lib/capture/claude-md-stanza.ts:56` (`upsertStanza`). Idempotent CLAUDE.md stanza insert/update during setup.

- **Memory Migration** — `lib/capture/memory-migrate.ts`, `scripts/migrate-memory.ts`, `skills/migrate-memory/`. Converts legacy `.claude/memory/` to `.claude/context/`.

- **Transcript Mining** — `lib/transcript/extractor.ts:121` (`extractFromWindow`). Core: `parser.ts`, `state.ts`, `scripts/mine-transcripts.ts`, `skills/mine-transcripts/`. Retrospective pattern extraction from session transcripts.

- **Configuration System** — `lib/config.ts`. 3-tier JSONC merge (plugin → per-project machine-local → git-committed project override) with hot-reload.

- **Session State / Daemon Lifecycle** — `scripts/session-start-hook.js`. Core: `lib/session-state.ts`, `scripts/lib/daemon-control.js`, `daemon-status.js`, `daemon-config.sh`, `skills/manage-daemon/`. Auto-start/health-check on SessionStart.

- **UserPromptSubmit Query Hook** — `scripts/query-hook.js`. Fires on every prompt, calls `/query`, injects result.

- **Awareness Hook** — `scripts/awareness-hook.js`. Second UserPromptSubmit hook, appends capture-mode footer.

- **Watch-Contexts Hook** — `scripts/watch-contexts.js`. PostToolUse (Write/Edit/MultiEdit/NotebookEdit) trigger for incremental re-embed.

- **Debug Statusline** — `lib/debug-statusline.ts:107` (`writeLastInjectionDebug`). Core: `scripts/install-debug-statusline.sh`, `install-statusline-bridge.sh`. Opt-in verbose statusline (`CONTEXTUS_DEBUG_STATUSLINE=1`).

- **Introspection** — `lib/introspect.ts:104` (`buildIntrospection`). Self-documenting endpoint exposing corpus stats + effective config.

- **Logging & Log Rotation** — `lib/logger.ts`, `lib/log-rotation.ts`. Backs `/contextus-watch`.

- **Skills Layer** — `skills/*` (24 total, not 26 — see [[implementation-doc-freshness-in-pr-checklist]]), `skills/ctx/` dispatcher. User-facing `/context-*`/`/contextus-*` slash commands.

- **CLI Tools** — `scripts/cli/*`, `scripts/search.ts`, `usage-rate.ts`, `cost-report.ts`, `tag-context.ts`, `link-project.ts`, `verify-lance.ts`, `watch.ts`. Standalone tsx scripts, no build step.

- **Setup / Upgrade / Install Automation** — `scripts/contextus-setup.ts`, `setup-detect.ts`, `upgrade-detect.ts`, `install-ollama.ts`, `pull-ollama-model.ts`, `fetch-model.ts`, `migrations/`, `templates/`.

- **Config Parsing Utilities** — `scripts/lib/parse-jsonc.js`, `captures-log.js`. Shared no-build JS helpers for hook scripts.

- **Workspace / Path Resolution** — `lib/workspace.ts`, `scripts/migrate-workspaces.ts`. Resolves per-project workspace paths/hashes.

- **Type Definitions** — `lib/types.ts`, `lib/version.ts`. Shared interfaces/types + version constant.

## Related

- [[implementation-doc-freshness-in-pr-checklist]] — same drift problem this file is meant to avoid
- `docs/FEATURES.md` — user-facing counterpart
- `PATHFINDER-2026-08-19/00-features.md` — raw Phase 0 subagent output this was distilled from

