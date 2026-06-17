# Changelog

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
