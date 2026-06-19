# Changelog

## [0.6.0] - 2026-06-19

### Added
- **Usage signal tracking**: Stop hook now ALWAYS parses the "Context: used:" provenance footer and logs `usage_signal` events to usage.jsonl. Previously only fired during calibration campaigns.
- **Usage rate report** (`pnpm usage-rate`): Headline metric — "context was used in XX% of injected responses." Per-pattern breakdown, low-value pattern flagging, `--project`/`--days`/`--json` filtering.
- **Footer parser** (`lib/calibration/parse-footer.ts`): Regex extraction of the provenance footer for structured analysis.

### Changed
- Stop hook (`scripts/stop-evaluation.js`): Refactored from calibration-only to always-on usage signal + optional calibration enqueuing.
- Logger gains `logUsageSignal` event type for the new `usage_signal` JSONL schema.

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
