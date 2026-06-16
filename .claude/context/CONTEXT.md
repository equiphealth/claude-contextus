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

## Questions (open)

- [daemon-lifecycle](questions/question-daemon-lifecycle.md) — OPEN: should the daemon run constantly, or idle-shutdown / session-aware? Leaning idle-timeout + /contextus-stop

## Gotchas

- [hook-files-esm-and-smoke-test](gotchas/gotcha-hook-files-esm-and-smoke-test.md) — Hook .js must be ESM (repo is type:module) AND smoke-tested via stdin, not just unit-tested

## Implementation

- [eslint-rules](implementation/eslint-rules.md) — ESLint rules adopted from the automation project
- [lancedb-api-surface](implementation/lancedb-api-surface.md) — Real @lancedb/lancedb v0.30 API vs DESIGN.md's Chroma sketch (verified)

## Project

- [embedding-download-risk](project/project-embedding-download-risk.md) — Transformers.js default needs HF downloads; corporate proxies block them
- [first-run-onboarding](project/project-first-run-onboarding.md) — Phase-6 first-run onboarding: auto-reconcile a cold corpus in the background
- [package-manager](project/project-package-manager.md) — Project uses pnpm, not npm

## Reference

- [build-prompts-doc](reference/reference-build-prompts-doc.md) — Paste-ready v1 build kickoff prompts live in docs/BUILD_PROMPTS.md
- [lancedb-connect-parent-dir](reference/reference-lancedb-connect-parent-dir.md) — LanceDB connect() takes the DB parent dir, not the .lance table dir
- [opus-metrics-critique](reference/reference-opus-metrics-critique.md) — Opus design feedback: tokens-saved is a vanity metric, measure real usage
