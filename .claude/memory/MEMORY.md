# Project Memory Index

Design decisions and feedback for claude-contextus. One line per memory; load the file for detail.

## Decisions
- [evaluation-architecture](decision_evaluation_architecture.md) — Stop hook + async worker for calibration quality eval
- [injection-format](decision_injection_format.md) — user-message prepend with bracketed framing
- [ollama-model-quality](decision_ollama_model_quality.md) — small local models unreliable for semantic eval; Haiku baseline
- [design-scoping-v1-v2](decision_design_scoping_v1_v2.md) — CAE/tags/self-doc/removal v1↔v2 placement; don't re-litigate mid-build
- [build-execution-cadence](decision_build_execution_cadence.md) — phase-then-return build cadence; where to stop vs batch
- [memory-to-context-migration](decision_memory_to_context_migration.md) — `.claude/memory/` → `.claude/context/` migration; hooks still read memory/

## Feedback
- [opus-metrics-critique](feedback_opus_metrics_critique.md) — "tokens saved" is a vanity metric; measure usage not injection
- [selfdoc-build-practice](feedback_selfdoc_build_practice.md) — verify context files before embedding; one ledger not four

## Project
- [package-manager](project_package_manager.md) — repo uses pnpm; always use pnpm commands
- [embedding-download-risk](project_embedding_download_risk.md) — Transformers.js default needs HF downloads that corporate proxies block; threatens out-of-box install

## Reference
- [build-prompts-doc](reference_build_prompts_doc.md) — paste-ready kickoff prompts live in docs/BUILD_PROMPTS.md
- [lancedb-connect-parent-dir](reference_lancedb_connect_parent_dir.md) — connect() needs the DB parent dir, not the .lance table dir (else zero tables)
