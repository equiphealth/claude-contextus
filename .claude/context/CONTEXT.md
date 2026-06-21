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
- [upgrade-lifecycle](decisions/decision-upgrade-lifecycle.md) — Breaking changes via PR + version bump; SessionStart notifies, never auto-migrates

## Questions (open)

- [daemon-lifecycle](questions/question-daemon-lifecycle.md) — OPEN: should the daemon run constantly, or idle-shutdown / session-aware? Leaning idle-timeout + /contextus-stop
- [source-embed-scope](questions/question-source-embed-scope.md) — OPEN: auto-embed only covers .claude/context/; docs/user/read-only sources need full manual re-embed, no per-source granularity

## Gotchas

- [hook-files-esm-and-smoke-test](gotchas/gotcha-hook-files-esm-and-smoke-test.md) — Hook .js must be ESM (repo is type:module) AND smoke-tested via stdin, not just unit-tested
- [embedding-provider-switch](gotchas/gotcha-embedding-provider-switch.md) — Switching provider/model (ollama→transformers) is a full re-embed; daemon refuses to inject on corpus/config mismatch
- [daemon-restart-on-upgrade](gotchas/gotcha-daemon-restart-on-upgrade.md) — Daemon must be killed before code upgrades; holds memoized connections and old code paths
- [warmup-failure-cascade](gotchas/gotcha-warmup-failure-cascade.md) — Warmup failure is permanent; config changes don't trigger retry; daemon stays stuck until manual kill

## Tradeoffs

- [embedding-provider-deployment](tradeoffs/tradeoff-embedding-provider-deployment.md) — Transformers.js vs local Ollama vs network Ollama: proxy gotchas, team deployment, decision matrix
- [empty-project-stamp](gotchas/gotcha-empty-project-stamp.md) — buildRows() defaults project to '' — rows embed fine but are invisible to workspace-scoped queries

## Implementation

- [proactive-capture](implementation/implementation-proactive-capture.md) — MUST propose context capture after implementation work; never wait to be asked; extract complete patterns not stubs
- [eslint-rules](implementation/eslint-rules.md) — ESLint rules adopted from the automation project
- [lancedb-api-surface](implementation/lancedb-api-surface.md) — Real @lancedb/lancedb v0.30 API vs DESIGN.md's Chroma sketch (verified)

## Project

- [embedding-download-risk](project/project-embedding-download-risk.md) — Transformers.js default needs HF downloads; corporate proxies block them
- [expansion-observability](project/project-expansion-observability.md) — Planned: fire rate in /context-status + log when expansion is skipped
- [first-run-onboarding](project/project-first-run-onboarding.md) — Phase-6 first-run onboarding: auto-reconcile a cold corpus in the background
- [package-manager](project/project-package-manager.md) — Project uses pnpm, not npm
- [pr-merge-checklist](project/project-pr-checklist.md) — Feature PRs require version bump, CHANGELOG, README update before merge
- [test-coverage-target](project/project-test-coverage.md) — Target ~80% coverage; exports + edge cases + failures, skip internal-helper obsession

## Reference

- [build-prompts-doc](reference/reference-build-prompts-doc.md) — Paste-ready v1 build kickoff prompts live in docs/BUILD_PROMPTS.md
- [lancedb-connect-parent-dir](reference/reference-lancedb-connect-parent-dir.md) — LanceDB connect() takes the DB parent dir, not the .lance table dir
- [opus-metrics-critique](reference/reference-opus-metrics-critique.md) — Opus design feedback: tokens-saved is a vanity metric, measure real usage
- [migration-system](reference/reference-migration-system.md) — How to add a breaking change: MIGRATIONS.md + upgrade-detect + version.ts + skill coordination
