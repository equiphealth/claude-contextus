# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unified database**: Single LanceDB at `~/.contextus/data/contextus.lance` replaces per-project isolation. All projects share one table with a `project` column (sha256 hash of absolute path, 12 chars). Eliminates row duplication for linked projects.
- **Workspaces**: JSONC files under `~/.contextus/workspaces/` define bidirectional project groups. Queries scope via `WHERE project IN (self, siblings, '__user__')`. Replaces the old `linkedProjects` config key.
- **`pnpm link-project` rewrite**: Now creates/joins workspaces instead of one-directional links. New flags: `--workspace <name>`, `--remove <path>`. Both projects see each other's context automatically.
- **User-level context sources**: `~/.contextus/context/` and `~/.contextus/docs/` stamped with `project: '__user__'` — visible to all workspace-scoped queries without explicit linking.
- **Upgrade detection on session start**: `checkUpgradeNeeded()` compares data version against installed package.json version, notifies user to run `/contextus-upgrade` when migrations are pending.
- **Version-gated migrations**: `upgrade-detect.ts` checks `~/.contextus/version.json` against installed version; only proposes migrations when the installed code actually supports them.
- **Silent Capture v2 staging mode**: Awareness hook supports `propose` (current default), `staging` (write directly, git is gate), and `silent` (no capture) modes via config.
- **Proactive capture reinforcement**: Three-layer obligation (awareness hook prompt, CLAUDE.md mandate, context pattern) ensures Claude proposes context capture after implementation work.
- **Telemetry proposal**: Design doc for future opt-in anonymous telemetry with transparency requirements and hard privacy boundaries (`docs/dev/TELEMETRY_PROPOSAL.md`).
- **Incremental CHANGELOG workflow**: Context pattern + workflow for updating changelog during development, not at PR merge time.
- **Regression test suite**: `tests/unified-db-scoping.test.ts` covers row ID uniqueness, project stamp consistency, keyword scoping, and `__user__` visibility.

### Changed
- **Package version**: 0.7.0 → 0.8.0 (breaking: requires re-embed for project column)
- **Global user sources**: Moved from `~/.claude/memory` / `~/.claude/docs` to `~/.contextus/context/` / `~/.contextus/docs/`
- **Row IDs**: Now globally unique — `<projectHash>:<relPath>#<chunkIndex>` (prevents cross-project collisions in unified DB)
- **`deleteByProject`**: Uses WHERE predicate pushed to LanceDB (O(matching rows), not O(total))
- **Watcher**: Now handles both `'change'` and `'rename'` events (in-place edits trigger re-embed)
- **`getInstalledVersion()`**: Uses `fileURLToPath(import.meta.url)` for Windows compatibility
- **link-project SKILL.md**: Rewritten for workspace-based API

### Fixed
- **Row ID collisions**: Two projects with the same relative filename no longer overwrite each other's rows
- **Unscoped deletion**: `deleteByFilename` and `getContentHashes` now accept `projectFilter` — operations don't cascade across projects
- **Reconcile missing projectId**: Stale file path in reconcile now passes `projectId` and `source` to `embedSingleFile`
- **User sources stamped wrong**: User context/docs rows were stamped with project hash (invisible to other projects); now stamped `__user__`
- **Keyword search cross-project leak**: `loadCorpusForKeyword` now accepts `projectScope` and applies `WHERE project IN (...)` filter — keyword/hybrid paths no longer return another project's patterns

## [0.7.0] - 2026-06-19

### Added
- **Linked projects**: `pnpm link-project <path>` shares another project's `.claude/context/` into the current corpus. Context from linked projects is ranked at 0.85 (below own patterns, above user context), watched for live changes (macOS/Win), and reconciled on session start.
- **Multi-source watcher**: fs.watch now covers all source directories (not just projectContext), detecting both deletions AND creations/modifications in linked projects.
- **`workflow_dispatch` force**: Release workflow gains a manual force option for re-releasing without a version bump.
- **Release workflow version diff**: Versioned releases now trigger on actual package.json version change (HEAD vs HEAD^) instead of tag existence check.

### Changed
- `embedSingleFile` accepts an optional `source` parameter (backward-compatible; defaults to `projectContext`).
- Full `pnpm embed` rebuilds now include linked project sources.
- Release process context pattern updated with "always branch first" convention.

## [0.6.0] - 2026-06-19

### Added
- **Interactive setup wizard**: `/contextus-setup` rewritten as a two-track guided experience — Quick (30s sane defaults) or Power User (explains each option, lets you customize). New `setup-detect.ts` gathers all project state in one JSON call.
- **Usage signal tracking**: Stop hook now ALWAYS parses the "Context: used:" provenance footer and logs `usage_signal` events to usage.jsonl. Zero API cost — pure regex + JSONL.
- **Usage rate report** (`pnpm usage-rate`): Headline metric — "context was used in XX% of injected responses." Per-pattern breakdown, low-value pattern flagging, `--project`/`--days`/`--json` filtering.
- **Expansion pre-warm**: qwen2.5:3b pinged at daemon startup so first expansion doesn't timeout (9.5s cold → 443ms warm).
- **Deletion detection**: fs.watch on `.claude/context/` dirs removes orphan rows from LanceDB on file deletion. macOS/Windows only; Linux falls back to reconcile-on-start.
- **`/contextus-setup --tune`**: Runs floor-replay calibration on real prompts, recommends injectionFloor + expansionThreshold, shows config diff.
- **Proactive capture**: Awareness footer updated to instruct Claude to extract complete patterns with examples/thresholds — not stubs.
- **Footer parser** (`lib/calibration/parse-footer.ts`): Regex extraction of the provenance footer for structured analysis.
- **`--help` on CLI scripts**: `usage-rate` and `cost-report` are now self-documenting. `cost-report` added to package.json.

### Changed
- Stop hook (`scripts/stop-evaluation.js`): Refactored from calibration-only to always-on usage signal + optional calibration enqueuing.
- Logger gains `logUsageSignal` event type for the new `usage_signal` JSONL schema.
- Session-start nudge updated to reference guided setup experience.

## [0.5.0] - 2026-06-18

### Added
- **Retrieval-miss proposals**: Evidence-driven context capture prompts when a query nearly matches but falls short of the injection floor (bestScore > 0.25 but < floor). Surfaces nearest topics, score gap, and actionable instructions for Claude to propose captures or ask users about missing context.
- **`scripts/test-api.sh`**: CLI utility for exercising all daemon endpoints. Supports individual endpoint testing or full sweep (`./scripts/test-api.sh all`).
- **Comprehensive API docs** (`docs/API.md`): Full HTTP endpoint reference with request/response schemas, degradation scenarios, and performance expectations.
- **Feature inventory** (`docs/FEATURES.md`): Complete capability listing covering retrieval, management, architecture, and configuration.
- **Implementation context files**: 8 new `.claude/context/implementation/` patterns covering retrieval pipeline, hybrid search, query expansion, injection floor, config hot-reload, auto-recovery, novelty tracking, and hit tracking.
- **Gotcha: project identifier mismatch**: Context pattern documenting that daemon expects `basename`, not full path.

### Fixed
- `scripts/test-api.sh` passes `basename` (not full path) as project identifier — matches daemon expectation.
- `daemon/server.ts` header comment now lists `/novelty` endpoint and links to `docs/API.md`.

### Changed
- PR checklist context pattern now explicitly requires `docs/FEATURES.md` and `docs/API.md` updates for feature PRs.
- `docs/DOCS.md` index updated with API.md entry.

## [0.4.0] - 2026-06-17

### Added
- **Hybrid search (RRF)**: Always-on keyword + semantic fusion via Reciprocal Rank Fusion. Nails exact-symbol queries ("getLogger" scores 0.408 semantically — misses the floor) by running BM25 keyword search in parallel with vector search and merging ranked lists. Adds < 20ms overhead. Configurable: `retrieval.hybrid: 'always' | 'off'`.
- **Keyword fallback**: BM25-inspired text scan fires when the embedding provider is unreachable (not slow). Gives SOME retrieval instead of complete silence when Ollama is down. Results tagged with a fallback notice.
- **Token cost reporting**: `/context-status --cost` shows overhead % (tokens injected ÷ prompt tokens) paired with calibration quality signal for org defensibility. New `prompt_tokens` field logged in usage.jsonl.
- **Cost report CLI**: `scripts/cost-report.ts` — parses usage logs, computes cost/value framing, supports `--project`, `--days`, `--json` flags.

### Changed
- `retrieval` config gains `hybrid` field (default: `'always'`)
- usage.jsonl retrieval events now include `prompt_tokens` field

## [0.3.0] - 2026-06-17

### Added
- **Unified provider registry**: Connection details (ollama endpoint, bedrock region, anthropic) defined once in `providers {}`, referenced by all features (embedding, expansion, calibration)
- **AWS Bedrock as first-class LLM provider**: Expansion fallback + calibration judge via `@aws-sdk/client-bedrock-runtime` (default credential chain)
- **Shared-budget fallback**: If primary expansion provider fails fast (<500ms), automatically retries with fallback provider using remaining time budget. Slow timeouts degrade gracefully without fallback.
- **JSONC config support**: All config files now use `.jsonc` with real `//` comments. Parser strips comments transparently; `_note` fields no longer needed.
- **Config hot-reload**: Mtime-based cache invalidation — edit config files and next query picks up changes without daemon restart.
- **Externalized awareness prompt**: Capture prompt text lives in `prompts/awareness-footer.txt`, editable without code changes. Broadened scope beyond patterns/decisions/gotchas.
- **Expansion observability in watch**: Expansion events get dedicated icons (`⚡` fired, `⊘` skipped), array values formatted with numbered entries.
- **Annotated sample config**: `examples/contextus.jsonc` as copy-and-trim starting point.

### Changed
- Expansion default model bumped from `qwen2.5:0.5b` to `qwen2.5:3b` (0.5b ignored structured generation instructions)
- Expansion prompt hardened with explicit TASK/RULES/EXAMPLE format and "Do NOT answer the query"
- Config files renamed: `plugin.json` → `plugin.jsonc`, `.claude/contextus.json` → `.jsonc`, `examples/` → `.jsonc`
- Log array formatting: arrays now show `[1] item | [2] item` instead of ambiguous comma-separation

### Fixed
- Config cache was infinite (never re-read files after first load) — now validates mtime on every access
- `parseKV` in watch.ts split comma-separated array values into broken key-value pairs

## [0.2.0] - 2026-06-16

### Added
- **Multi-vector query expansion**: Adaptive synonym/paraphrase recall via LLM-generated alternate queries. When initial search scores below threshold, generates 2-3 rephrasings, embeds each independently, and unions results (keeping highest similarity per chunk). Configurable: provider (ollama/anthropic), threshold, max variants, timeout.
- **CI-built releases**: `dist/` removed from git; CI builds fresh on every push. `latest` pre-release updates on every main push; versioned releases auto-create on version bumps.
- **`ensureDistBuilt()` in SessionStart**: Auto-builds dist if missing (from release tarball install), with lockfile concurrency guard and structured error reporting.

### Changed
- Renamed CI workflow from `ci.yml` to `test.yml`
- Release workflow now reads version from `package.json` (no manual tagging needed)

### Fixed
- Expansion config validation: clamps `expansionThreshold` (0-1) and `temperature` (0-2)
- Expansion uses configurable `temperature` and `timeoutMs` (was hardcoded)
- Union dedup correctly keeps highest similarity per id
