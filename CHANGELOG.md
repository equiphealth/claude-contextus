# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Verbose debug statusline** (`scripts/install-debug-statusline.sh`) — opt-in status-bar line showing what contextus did on the last `/query`: injected count vs candidates, best match % vs floor %, tokens injected, latency, expansion/hybrid status, a `budget:` capacity-protection tier, `src:<file>+N` showing which file actually got injected (bounded to the first filename + a count, not every filename — the full list still lives in `injectedFiles` in the underlying JSON), a rolling "% useful" average from background usage evaluation, and a `new:+N(file)` indicator when `/capture` or `/delete` wrote to `captures.log` since this session's statusline last rendered. Toggle with `CONTEXTUS_DEBUG_STATUSLINE=1`/unset — no reinstall needed to turn on/off. Layout via `CONTEXTUS_DEBUG_STATUSLINE_LAYOUT=newline` (default) `|inline` — no single join format looks right against every existing statusline script, so this is a toggle rather than a hardcoded default. (A `right` column-padded layout was prototyped and dropped before release: width detection via `$COLUMNS` worked, but Claude Code's status bar reflows/normalizes the printed line, so the padding math rendered as a wrapped line indistinguishable from `newline`.) Installed automatically by `/contextus-setup` and `/contextus-upgrade` (alongside the existing capacity-protection bridge); stays silent for everyone until they set the env var.
- **`lib/debug-statusline.ts`** — the daemon writes a per-session `~/.contextus/runtime/<sessionId>.last-injection.json` snapshot after every `/query` (fire-and-forget, after the response is already sent). Combines the immediate query outcome with a rolling average from this project's `usage-ratings.jsonl`, since usage evaluation runs in a background loop and rates the previous turn's injection a few seconds after the fact — no synchronous per-injection "useful" signal exists, so a rolling average is both more available and less noisy than trying to match one promptHash.

## [0.17.0] - 2026-07-21

### Added
- **`POST /delete` daemon endpoint** — archives a context file instead of hard-deleting: moves it to `.claude/context/.archive/` (flat, matching `/context-archive`'s existing documented layout), removes its `CONTEXT.md` index entry, and drops its LanceDB rows. Never destructive — an archived file is one `mv` away from being restored; cleanup of `.archive/` itself is left to the user. Like `/capture`, `/delete` is never hook-triggered and never returns `{continue: true}` on failure — always an honest `{ok: false, error}`.
- **`.archive/**` excluded from default source config** — `projectContext` and `userContext` sources (in `lib/config.ts` DEFAULTS and `plugin.jsonc`) now exclude `.archive/**` from their embed glob, so archived files never get swept back into the corpus by a full `pnpm embed` rebuild.

### Changed
- **`/context-archive` skill now backed by a real endpoint** — previously documented pseudo-code pointing at a nonexistent `lib/archive.ts`; now calls the daemon's `/delete` endpoint directly, same pattern as `/create-context` calling `/capture`.

### Fixed
- **`/delete` no longer overwrites an existing archived file on a basename collision** — archiving flattens category subdirectories, so a reused slug (fix → archive → later a differently-scoped file with the same filename gets archived too) used to silently clobber the earlier archived copy. Now de-dupes with a numeric suffix (`gotcha-foo.md` → `gotcha-foo-2.md`) instead of destroying history.
- **`/delete`'s 500 response on embedding-cleanup failure now reports `archivedRelPath`/`removedFromIndex`** — the file move and index-line removal happen before the embeddings step, so a failure there was previously reported as `{ok: false}` with no indication those side effects had already occurred, and a naive retry would then hit a confusing 404 against the (now-moved) original path.

## [0.16.0] - 2026-07-21

### Fixed
- **`/capture` no longer returns `{continue: true}` on failure** — that response shape is for hook-triggered endpoints (`/query`, `/notify`, `/reconcile`) where "never block the prompt" is the right fallback. `/capture` is never hook-triggered, so it shared a response shape that made failures indistinguishable from success. `/capture` now gets its own dispatch branch, returning `{ok: false, error: ...}` on any failure (e.g. malformed JSON body) instead of falling through to the shared hook-degrade path.

## [0.15.0] - 2026-07-20

### Fixed
- **Capture queue during heavy operations** — Context capture requests no longer fail silently when daemon is busy with embedding operations. Implemented in-memory queue with error handling to prevent permanent queue wedging.

## [0.14.0] - 2026-07-08

### Added
- **`/ctx` dispatcher skill** — Unified shortcut interface for 18 contextus commands (like `npm run`). Type `/ctx` to see all available shortcuts, `/ctx <subcommand>` to execute. Replaces 8 individual `ctx-*` alias skills with one self-documenting dispatcher.
- **Ollama auto-install in setup wizard** — `/contextus-setup` now detects Ollama installation state and offers automatic installation on macOS (Homebrew) and Linux (official script). Includes model download progress tracking.
- **Corpus metadata in `/context-stats`** — Status output now includes total file count and last-embedded timestamp without requiring supplemental bash commands.
- **Execution pattern directives** — Skills explicitly distinguish between silent system commands (status, stats) and conversational wizards (setup, migrate) to reduce over-narration.
- **CAPTURE_PHILOSOPHY.md** — Comprehensive guide on what belongs in `.claude/context/` vs docs vs memory, with durability tests and good/bad examples.

### Changed
- **Skill token optimization** — Moved implementation details from SKILL.md (eager-loaded) to colocated `reference.md` files (loaded on-demand). Skills now 10-40 lines instead of 50-628 lines. Total registry reduced from ~12,700 → ~3,400 tokens (73% reduction).
- **Skill namespace cleanup** — `/ctx status|stats|create|calibrate|doctor|watch|daemon|setup|search|review|rebuild|configure|upgrade|migrate|audit|archive|merge` all accessible via dispatcher.
- **Setup detection improvements** — `setup-detect.ts` now reads unified `projects.json` instead of scanning filesystem for per-project lance directories.
- **Package version**: 0.13.0 → 0.14.0

### Fixed
- **Setup skill CLAUDE_PLUGIN_ROOT usage** — Fixed hardcoded paths; now uses environment variable correctly.
- **User context path docs** — Corrected references from `~/.claude/context` to `~/.contextus/context`.

### Documentation
- Added `docs/dev/design/ollama-install-integration.md` — Design for Ollama detection and auto-install flow
- Added `docs/dev/design/IMPLEMENTATION_STATUS.md` — Implementation tracking across features
- Context patterns captured: `arch-skill-token-optimization-strategy.md`, `reference-skill-execution-patterns.md`, `reference-cli-tools-self-contained.md`, `tradeoff-skill-alias-context-cost-tradeoff.md`, `reference-claude-code-skill-system-feature-requests.md`

## [0.13.0] - 2026-06-27

### Added
- **Token overflow protection** — Graduated injection throttling prevents API 400 errors when conversations approach model context limits. Reads context-window stats from the statusline via a filesystem bridge and applies configurable thresholds (reduce at 70%, minimal at 80%, disable at 85%). Fixes #17.
- **Statusline bridge installer** — `scripts/install-statusline-bridge.sh` idempotently patches `~/.claude/statusline-command.sh` to write context-window stats that contextus reads for capacity decisions.
- **`capacityProtection` config section** — Configurable thresholds for graduated degradation in `plugin.jsonc` and `.claude/contextus.jsonc`.
- **Stale stats cleanup** — Session-start hook removes context-stats files older than 24 hours.

### Changed
- **`/query` endpoint** accepts optional `contextStats` parameter with `{input_tokens, output_tokens, used_percentage}` for capacity-aware injection decisions.
- **Setup and upgrade skills** now install the statusline bridge automatically.
- **Package version**: 0.12.0 → 0.13.0

### Migration
This release adds the statusline bridge — run `/contextus-upgrade` or manually:
```bash
bash ~/src/claude-contextus/scripts/install-statusline-bridge.sh
```
No database migration needed. The bridge is optional; without it, contextus continues to inject normally (no overflow protection).

## [0.12.0] - 2026-06-27

### Added
- **Automatic upgrade notification** — SessionStart hook now detects when the plugin has been updated and notifies users. Checks MIGRATIONS.md to determine if breaking changes require `/contextus-upgrade` or if it's just a code-only update.
- **Floor-free search endpoint** — New `POST /search` endpoint returns raw similarity scores without injection floor filtering. Enables `/context-search` skill to show ALL matching patterns with scores, useful for debugging retrieval and understanding why patterns fall below the threshold.
- **Project identifier normalization** — Daemon now accepts project identifiers in three forms (friendly name like "automation", SHA256 hash, or full path) and normalizes them to canonical hash before DB operations. Fixes cross-project search bugs.
- **Upgrade documentation** — Comprehensive `docs/UPGRADE_GUIDE.md` with step-by-step migration instructions for existing installations. Documents unified DB migration and registry cleanup process.
- **Migration registry** — Updated `migrations/MIGRATIONS.md` with 0.12.0 breaking changes for `/contextus-upgrade` skill consumption.

### Changed
- **Unified database architecture** — All projects now share one LanceDB instance at `~/.contextus/data/contextus.lance` instead of per-project databases. Project isolation via `project` column (SHA256 hash of absolute path).
- **Dynamic port discovery** — Daemon can bind to OS-assigned port if preferred port 37800 is unavailable. Port resolution centralized with caching across all daemon clients.
- **Skill naming consolidated** — Standardized naming: `context-*` for corpus operations, `contextus-*` for system operations, `ctx-*` for aliases only.
- **Package version**: 0.11.0 → 0.12.0

### Fixed
- **Project scoping bug** — Daemon endpoints now use normalized project hash for ALL DB operations (tableExists, search, loadCorpusForKeyword, incrementHits). Previously used raw string causing empty results.
- **Registry corruption** — Cleared corrupted `projects.json` entries where projects were registered with wrong paths.
- **Hook port references** — Updated all hooks to use `getBaseURL()` function instead of hardcoded `BASE_URL` constant for dynamic port resolution.

### Breaking Changes
**This release requires migration** — run `/contextus-upgrade` when ready, or see `docs/UPGRADE_GUIDE.md` for manual steps.

The upgrade involves:
1. Stopping the daemon
2. Clearing old per-project databases and corrupted registry
3. Re-embedding each project corpus with unified DB + project normalization
4. Restarting the daemon

The `/contextus-upgrade` skill automates this process and verifies each step.

## [0.11.0] - 2026-06-26

### Added
- **Phase 2 Usage Feedback Curation Workflows** — Interactive corpus maintenance based on Phase 1 evaluation data. Includes `/context-stats` CLI + skill (usage analytics: most useful, noisy, stale, never retrieved), `/context-review` skill (interactive curation: archive/rewrite/merge), `/context-archive` skill (bulk or single-file archival), `/context-merge` skill (LLM-assisted duplicate merge), and `/context-doctor` usage-driven health checks (stale/noisy/duplicate detection, eval queue monitoring).
- **Design decision captured** — `decision-no-promotion-path.md` documents why curation (archive/rewrite/merge) is correct and promotion (copy to CLAUDE.md) is wrong. High-value patterns prove themselves via retrieval scores; copying them to CLAUDE.md would add prompt bloat and remove semantic gating.

### Changed
- **Package version**: 0.10.0 → 0.11.0

### Fixed
- **context-stats.ts variable naming** — Renamed `eval` to `evalItem` throughout aggregation logic. Variable name `eval` conflicts with strict mode in ESM output format, causing esbuild transform errors.

## [0.10.0] - 2026-06-26

### Added
- **Phase 1 Usage Evaluation** — Stop hook enqueues prompt+response+injected context, eval-loop polls queue and drains with Haiku rating each chunk on 1-5 scale (critical/helpful/mentioned/somewhat-helpful/unused). Writes to `~/.contextus/data/<projectId>/usage-ratings.jsonl`. Cost: ~$0.001/query. **THE KEYSTONE** — unblocks Track B analytics (context-stats, context-review, context-doctor).
- **Multi-source loading** — Daemon now iterates over all enabled sources from config instead of hardcoding projectContext. All four sources (projectContext, projectDocs, userContext, userDocs) embed when enabled. File watching covers all sources. `/notify` endpoint detects which source a file belongs to via path matching.
- **Growth tracking** — Status CLI (`/context-status`) now scans `.claude/context/` and `docs/` for 30-day mtime growth metrics. Reports `+N patterns, +N docs` recently added.
- **Evaluation queue resilience** — Queue drain continues even if individual evaluation jobs fail. Campaign end (sampleCount >= targetSamples) safely stops drain without clearing remaining queue.
- **Status CLI for Phase 2** — Standalone `scripts/cli/status.ts` executable for corpus analytics. Foundation for context-stats/context-review workflows.

### Changed
- **Source naming** — Renamed `projectMemory` → `projectContext` in config for consistency with source column values. No mapping layer needed.
- **Package version**: 0.9.0 → 0.10.0

### Fixed
- **User sources not loading** — User-scoped sources (`userContext`, `userDocs`) defined in config but never embedded. Now reconcile loop processes all enabled sources with correct scope handling (project vs user projectId).
- **Status CLI spec divergence** — Growth tracking was promised in skill spec but missing from implementation. Now implemented.
- **Enqueue/drain gate mismatch** — Fixed race condition where evaluateUsage flag could flip during queue drain.
- **ESM __dirname shim** — Added shim for cost-report script (ESM modules don't have __dirname).
- **JSONC comment parsing** — `loadedSourceNames()` now strips comments before JSON.parse (was silently failing, returning []).

## [0.9.0] - 2026-06-23

### Added
- **Transcript mining** — Extract reusable patterns from Claude Code session logs (`.jsonl`). Mines thinking blocks, text, and tool calls to surface decisions, gotchas, and conventions that weren't captured during the session. Uses Bedrock Haiku (Ollama fallback) with 0.6 confidence threshold.
- **Incremental scanning** — Watermark-based state (`~/.contextus/transcript-state.json`) tracks what's been processed per project. Recurring runs only scan the delta.
- **Dedup check** — Before writing a mined pattern, queries the daemon `/query` endpoint for corpus similarity (threshold: 0.82). Prevents duplicate captures.
- **`pnpm mine-transcripts` CLI** — Flags: `--project`, `--all`, `--since`, `--dry-run`, `--list`, `--max-sessions`. Defaults to 1-day lookback, 3 sessions max.
- **Transcript parser tests** — 24 unit tests covering slug derivation, session parsing, turn filtering, window chunking, and extraction response validation.

### Changed
- **Package version**: 0.8.1 → 0.9.0

## [0.8.1] - 2026-06-21

### Added
- **POST /capture endpoint** — daemon-mediated file writes for context and docs, replacing noisy Write+Edit tool calls with a single HTTP request. Supports `target: "context"` (structured frontmatter, category dirs) and `target: "doc"` (raw markdown, flat). File writes are synchronous (<10ms); embedding fires async (fire-and-forget with reconcile safety net).
- **Configurable `captureFooter`** — `"always"` (default) emits "Context: captured:" confirmation lines; `"off"` suppresses them. Config in `contextCapture` block.
- **Staging capture mode** — default capture mode flipped from `propose` to `staging` (Claude writes context files directly; user reviews at git-staging time)
- **Captures log** — append-only audit trail at `~/.contextus/captures.log`
- **Provider injection** — `createTable()` accepts caller-provided providerInfo, decoupling from static config
- **Warmup failure cascade gotcha** — documented the daemon stuck-state failure mode and workaround
- **Embedding provider deployment tradeoff** — documented Transformers.js vs Ollama vs network Ollama decision matrix

### Changed
- **CLAUDE.md stanza** — no longer tells models to "wait for the awareness footer to invite" capture; now says to follow the per-prompt injected footer exactly (mode-aware)
- **Staging footer** — rewritten for stronger model compliance: capture-first sequencing, explicit DO-NOT-PROPOSE instruction, self-test rule; emits capture confirmation for all scopes (project + user)
- **embed-contexts.ts** — uses `loadProjectConfig()` for proper 3-tier config merge

### Fixed
- **Awareness hook `captureMode()`** — now reads project-level `.claude/contextus.jsonc` (was only reading plugin.jsonc, silently ignoring project overrides)
- **Tag YAML quoting** — `/capture` now produces `tags: ["foo", "bar"]` instead of `tags: [foo, bar]` for valid YAML
- **lance-client.ts type error** — `ollamaModel ?? model` fallback for `string | undefined`
- **embed-contexts.ts unused import** — removed dead `loadConfig` import

## [0.8.0] - 2026-06-21

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
