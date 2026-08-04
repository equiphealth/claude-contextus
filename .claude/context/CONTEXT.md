# Contextus Context Index

This directory contains captured patterns, decisions, and implementation notes for the contextus project itself. One line per file; organized by semantic category (`feedback` is banned — see CATEGORIES_AND_TAGS.md §1).

## Decisions

- [build-execution-cadence](decisions/decision-build-execution-cadence.md) — How to run the v1 build: phase-then-return cadence, where to stop vs batch
- [calibration-two-signals](decisions/decision-calibration-two-signals.md) — Two independent floor-calibration signals (similarity-replay vs Haiku usage)
- [design-scoping-v1-v2](decisions/decision-design-scoping-v1-v2.md) — v1/v2 scoping for the CAE, categories/tags, self-documentation, and removal
- [evaluation-architecture](decisions/decision-evaluation-architecture.md) — Calibration evaluation design: Stop hook + async worker with thinking blocks
- [floor-calibration-signals](decisions/decision-floor-calibration-signals.md) — Empirical Phase-1 retrieval findings that seed Phase-5 floor calibration
- [injection-format](decisions/decision-injection-format.md) — User-message prepend with bracketed framing for context injection
- [memory-to-context-migration](decisions/decision-memory-to-context-migration.md) — Migration from .claude/memory/ to .claude/context/
- [daemon-from-dist](decisions/decision-daemon-from-dist.md) — Daemon runs from compiled dist/ (node dist/daemon/server.js), not tsx; dist/ committed
- [npm-not-used](decisions/decision-npm-not-used.md) — Not published to npm; marketplace install git-clones the repo
- [ollama-model-quality](decisions/decision-ollama-model-quality.md) — Ollama small models unreliable for semantic eval, but fine for embedding
- [selfdoc-build-practice](decisions/decision-selfdoc-build-practice.md) — How Claude self-documents during the build: verify before embedding, one ledger
- [stage-explicit-paths](decisions/decision-stage-explicit-paths.md) — Never `git add -A`; stage only the explicit paths you changed
- [versioning](decisions/decision-versioning.md) — SemVer in manifests, stay 0.x until verified 1.0; "v1.1/v2" are roadmap labels
- [proactive-ux-positioning](decisions/proactive-ux-positioning.md) — Killer feature is zero-query injection, not search
- [generic-examples-only](decisions/decision-generic-examples-only.md) — Docs/contexts/examples must use generic placeholders or contextus self-refs, never other real project names
- [unified-db-workspaces](decisions/decision-unified-db-workspaces.md) — Single shared LanceDB with project-hash column; workspaces for bidirectional cross-project sharing
- [capture-noise-reduction](decisions/decision-capture-noise-reduction.md) — Reduce staging capture noise: daemon /capture endpoint now, MCP tool later; subagent as zero-code experiment
- [upgrade-lifecycle](decisions/decision-upgrade-lifecycle.md) — Breaking changes via PR + version bump; SessionStart notifies, never auto-migrates
- [node-protocol-imports](decisions/decision-node-protocol-imports.md) — Always use `node:` prefix for built-in imports; keep `async function main()` pattern (reject S7785)
- [activity-triggered-retrieval](decisions/decision-activity-triggered-retrieval.md) — Design: inject context based on file-edit activity signals, not just prompt text similarity
- [extraction-source-candidates](decisions/decision-extraction-source-candidates.md) — Ranked inventory of context extraction sources: PRs, issues, CI logs, review comments, chat
- [unified-extraction-pipeline](arch/arch-unified-extraction-pipeline.md) — One extraction system with pluggable source adapters; shared pipeline for all sources
- [project-registry](arch/arch-project-registry.md) — Lazy hash→path/name registry at projects.json for readable UX and bidirectional resolution

## Questions (open)

- [daemon-lifecycle](questions/question-daemon-lifecycle.md) — OPEN: should the daemon run constantly, or idle-shutdown / session-aware? Leaning idle-timeout + /contextus-stop
- [source-embed-scope](questions/question-source-embed-scope.md) — OPEN: auto-embed only covers .claude/context/; docs/user/read-only sources need full manual re-embed, no per-source granularity

## Gotchas

- [hook-files-esm-and-smoke-test](gotchas/gotcha-hook-files-esm-and-smoke-test.md) — Hook .js must be ESM (repo is type:module) AND smoke-tested via stdin, not just unit-tested
- [embedding-provider-switch](gotchas/gotcha-embedding-provider-switch.md) — Switching provider/model (ollama→transformers) is a full re-embed; daemon refuses to inject on corpus/config mismatch
- [daemon-restart-on-upgrade](gotchas/gotcha-daemon-restart-on-upgrade.md) — Daemon must be killed before code upgrades; holds memoized connections and old code paths
- [warmup-failure-cascade](gotchas/gotcha-warmup-failure-cascade.md) — Warmup failure is permanent; config changes don't trigger retry; daemon stays stuck until manual kill
- [skill-project-scoping](gotchas/gotcha-skill-project-scoping.md) — Skills must compute projectId hash and pass it to daemon endpoints (/introspect, /query, etc) for correct per-project isolation
- [project-column-isolation-bug](gotchas/gotcha-project-column-isolation-bug.md) — CRITICAL: Unified DB WHERE project IN filter not working — queries return rows from other projects instead of scoped results
- [status-cli-spec-divergence](gotcha/gotcha-status-cli-spec-divergence.md) — Status CLI implementation missing growth tracking promised in skill spec
- [calibration-bootstrap-catch22](gotcha/gotcha-calibration-bootstrap-catch22.md) — Calibration can't collect samples when injection floor prevents all injections
- [user-sources-not-loaded](gotcha/gotcha-user-sources-not-loaded.md) — [FIXED] User-scoped sources defined but never embedded; only projectContext loads
- [workspace-file-format](gotcha/gotcha-workspace-file-format.md) — Workspace files require projects as objects with path property, not string arrays
- [loadedSourceNames-jsonc-parse](gotcha/gotcha-loadedSourceNames-jsonc-parse.md) — [FIXED] loadedSourceNames() failed to strip JSONC comments, returned empty packs array
- [calibrate-floor-project-param](gotcha/gotcha-calibrate-floor-project-param.md) — Floor calibration --project expects name substring, not projectId hash
- [plugin-dir-hook-merging](gotcha/gotcha-plugin-dir-hook-merging.md) — --plugin-dir installs require manual hook merging from hooks/hooks.json to settings.json
- [stop-hook-transcript-timing](gotcha/gotcha-stop-hook-transcript-timing.md) — Stop hook fires before transcript write completes — response not yet on disk when hook reads file
- [empty-project-stamp](gotchas/gotcha-empty-project-stamp.md) — buildRows() defaults project to '' — rows embed fine but are invisible to workspace-scoped queries

## Tradeoffs

- [embedding-provider-deployment](tradeoffs/tradeoff-embedding-provider-deployment.md) — Transformers.js vs local Ollama vs network Ollama: proxy gotchas, team deployment, decision matrix
- [staging-capture-visibility](tradeoffs/tradeoff-staging-capture-visibility.md) — Write tool calls are visible in UI; no silent file creation on-platform; accept noise as cost of transparency
- [project-id-hash-vs-path](tradeoff/tradeoff-project-id-hash-vs-path.md) — ProjectId uses SHA256 hash for stability but sacrifices debuggability - operators can't identify projects from logs/directories

## Implementation

- [proactive-capture](implementation/implementation-proactive-capture.md) — MUST propose context capture after implementation work; never wait to be asked; extract complete patterns not stubs
- [eslint-rules](implementation/eslint-rules.md) — ESLint rules adopted from the automation project
- [lancedb-api-surface](implementation/lancedb-api-surface.md) — Real @lancedb/lancedb v0.30 API vs DESIGN.md's Chroma sketch (verified)
- [skill-project-scoping-fixes](implementation/implementation-skill-project-scoping-fixes.md) — Fix plan: add projectId parameter to /context-status, /context-doctor, /rebuild-embeddings daemon calls
- [daemon-project-scoping-fix](implementation/implementation-daemon-project-scoping-fix.md) — Daemon should accept only projectId (not cwd), look up workspace scope and config by projectId alone
- [multi-source-loading](implementation/implementation-multi-source-loading.md) — [FIXED] All enabled sources (projectContext/projectDocs/userContext/userDocs) now load via config iteration

## Project

- [embedding-download-risk](project/project-embedding-download-risk.md) — Transformers.js default needs HF downloads; corporate proxies block them
- [expansion-observability](project/project-expansion-observability.md) — Planned: fire rate in /context-status + log when expansion is skipped
- [first-run-onboarding](project/project-first-run-onboarding.md) — Phase-6 first-run onboarding: auto-reconcile a cold corpus in the background
- [package-manager](project/project-package-manager.md) — Project uses pnpm, not npm
- [pr-merge-checklist](project/project-pr-checklist.md) — Feature PRs require version bump, CHANGELOG, README update before merge
- [test-coverage-target](project/project-test-coverage.md) — Target ~80% coverage; exports + edge cases + failures, skip internal-helper obsession
- [skill-fixes-applied](project/project-skill-fixes-applied.md) — Fixed 3 skills to compute projectId and pass it to daemon endpoints for correct per-project scoping

## Reference

- [build-prompts-doc](reference/reference-build-prompts-doc.md) — Paste-ready v1 build kickoff prompts live in docs/BUILD_PROMPTS.md
- [lancedb-connect-parent-dir](reference/reference-lancedb-connect-parent-dir.md) — LanceDB connect() takes the DB parent dir, not the .lance table dir
- [opus-metrics-critique](reference/reference-opus-metrics-critique.md) — Opus design feedback: tokens-saved is a vanity metric, measure real usage
- [migration-system](reference/reference-migration-system.md) — How to add a breaking change: MIGRATIONS.md + upgrade-detect + version.ts + skill coordination
- [setup-provider-cascade](decisions/decision-setup-provider-cascade.md) — Setup wizard tries transformers.js first, falls back to Ollama with assisted install
- [capture-async-embed](decisions/decision-capture-async-embed.md) — POST /capture should write file synchronously but embed asynchronously for instant response
- [setup-wizard-ollama-flow](phase/phase-setup-wizard-ollama-flow.md) — Setup wizard Ollama install flow: detect failure, link to download, wait for install, pull model from menu, start server
- [docs-as-retrieval-incentive](project/project-docs-as-retrieval-incentive.md) — Tags and categories in docs create a behavioral nudge — engineers write more structured docs when retrieval rewards it
- [transcript-mining-recurring](decisions/decision-transcript-mining-recurring.md) — Transcript mining runs on a schedule (not just setup), with watermark tracking for incremental scans
- [telemetry-transparency-requirement](decisions/decision-telemetry-transparency-requirement.md) — Telemetry must be opt-in during setup with complete transparency; treat user data as high-trust asset
- [telemetry-expansion-provider-tracking](api/api-telemetry-expansion-provider-tracking.md) — Track which LLM provider (ollama/bedrock/anthropic) handles query expansion, not hardcode fallback chains
- [telemetry-environment-filtering](implementation/implementation-telemetry-environment-filtering.md) — Exclude dev/test/maintainer usage from production telemetry metrics to avoid data pollution
- [daemon-context-create-vs-update](reference/reference-daemon-context-create-vs-update.md) — How to create new vs update existing context files - /capture overwrites on duplicate slug
- [daemon-context-create-vs-update](reference/reference-daemon-context-create-vs-update.md) — How to create new vs update existing context files - /capture overwrites on duplicate slug
- [no-promotion-path](decisions/decision-no-promotion-path.md) — Why contextus feedback loop drives curation (archive/rewrite/merge) not promotion (copy to CLAUDE.md)
- [hook-js-ts-duplication](gotchas/gotcha-hook-js-ts-duplication.md) — Hooks use plain JS (no build step) while core uses TS, requiring duplicate port discovery logic
- [project-identifier-everywhere](gotchas/gotcha-project-identifier-everywhere.md) — All daemon endpoints must normalize project identifiers (name/hash/path) to canonical hash before DB operations
- [upgrade-notification-flow](implementation/implementation-upgrade-notification-flow.md) — Automatic upgrade notification flow when plugin is updated via marketplace
- [token-overflow-protection-architecture](implementation/implementation-token-overflow-protection-architecture.md) — Three-layer statusline bridge architecture for preventing token overflow in long conversations
- [setup-detect-unified-db](gotchas/gotcha-setup-detect-unified-db.md) — setup-detect.ts must read projects.json for existingProjects, not scan for per-project lance directories
- [extraction-source-candidates](decisions/decision-extraction-source-candidates.md) — Ranked list of potential context extraction sources beyond transcripts — PRs, issues, CI logs, review comments, code comments
- [skill-token-optimization-strategy](arch/arch-skill-token-optimization-strategy.md) — Skill file architecture — slim SKILL.md files with reference docs in docs/skills/ to minimize system prompt overhead
- [skill-execution-patterns](reference/reference-skill-execution-patterns.md) — Two skill execution patterns: silent system commands vs conversational wizards
- [cli-tools-self-contained](reference/reference-cli-tools-self-contained.md) — CLI tools should be comprehensive and self-contained — skills execute once and present results
- [skill-alias-context-cost-tradeoff](tradeoffs/tradeoff-skill-alias-context-cost-tradeoff.md) — Skill aliases cost context in Claude Code (no native aliasing primitive); slim SKILL.md files are the best available workaround
- [claude-code-skill-system-feature-requests](reference/reference-claude-code-skill-system-feature-requests.md) — Feature requests for Claude Code skill system discovered while building contextus — native aliasing and argument autocomplete
- [skill-token-optimization-strategy](arch/arch-skill-token-optimization-strategy.md) — Skill file architecture — slim SKILL.md with reference docs, but triggers MUST stay in SKILL.md
- [skill-testing-execution-philosophy](reference/reference-skill-testing-execution-philosophy.md) — Skills must execute fully during testing with minimal narration - show real results, not summaries
- [skill-execution-model-capability-gap](gotchas/gotcha-skill-execution-model-capability-gap.md) — Smaller models (Haiku) often ignore skill execution directives in favor of conversational responses
- [v3-pull-based-retrieval-evolution](phase/phase-v3-pull-based-retrieval-evolution.md) — V3+ architectural evolution toward pull-based retrieval alongside current push injection
- [source-exclude-config-not-merged](gotchas/gotcha-source-exclude-config-not-merged.md) — sources.*.exclude overrides in .claude/contextus.json are ignored — resolveSources uses raw plugin.json instead of merged config
- [source-exclude-config-not-merged](implementation/implementation-source-exclude-config-not-merged.md) — FIXED 2026-07-20: sources.*.exclude patterns now properly merge from project config (was: resolveSources used raw plugin.json)
- [bug-documentation-lifecycle](decisions/decision-bug-documentation-lifecycle.md) — How to manage gotcha/implementation documentation as bugs move from discovered → fixed → historical
- [expansion-hallucination-inflates-injection-score](gotchas/gotcha-expansion-hallucination-inflates-injection-score.md) — Adaptive query expansion (qwen2.5:3b) can hallucinate a phrasing that literally string-matches an unrelated stored pattern, inflating the reported best-score well above what the raw prompt alone would ever hit
- [expansion-hallucination-inflates-injection-score](gotchas/gotcha-expansion-hallucination-inflates-injection-score.md) — Adaptive query expansion (qwen2.5:3b) can hallucinate a phrasing that literally string-matches an unrelated stored pattern, inflating the reported best-score well above what the raw prompt alone would ever hit. Empirically tested phi4-mini and Haiku as alternatives -- neither swap-the-model option is a clean win.
- [claude-code-hook-surface-limitations](tradeoffs/tradeoff-claude-code-hook-surface-limitations.md) — Two architectural workarounds contextus needs specifically because Claude Code's hook surface doesn't expose these directly: context-window usage, and mid-task injection
- [thinking-blocks-as-independent-usage-verification](tradeoffs/tradeoff-thinking-blocks-as-independent-usage-verification.md) — Visible thinking blocks were an independent cross-check on the self-reported 'Context: used:' footer calibration relies on -- losing them (if Sonnet 5's adaptive reasoning removes visible blocks) weakens usage-signal quality, not just debugging convenience
