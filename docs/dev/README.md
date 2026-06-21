# Contextus — Developer / Build Docs

Material for **building and contributing to** contextus: design specs, build history,
roadmap, and design reviews. For **using** contextus, see [../DOCS.md](../DOCS.md).

## Architecture & design

- **[DESIGN.md](DESIGN.md)** — Complete system architecture; the canonical reference.
- **[DESIGN ADDENDUM.md](DESIGN%20ADDENDUM.md)** — Supplementary design notes.
- **[DESIGN_QUESTIONS.md](DESIGN_QUESTIONS.md)** — Pre-implementation decisions + status.
- **[CONTEXT_APPLICABILITY_EVALUATOR.md](CONTEXT_APPLICABILITY_EVALUATOR.md)** — CAE spec
  (the v2 semantic gating layer).
- **[SILENT_CAPTURE_V2.md](SILENT_CAPTURE_V2.md)** — v2 auto-capture design: git review as
  the gate, zero mid-session interruptions.
- **[CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md)** — Category vs tag ontology rules.
- **[LOGGING.md](LOGGING.md)** — Dual-format logging schema.
- **[DECISION-embedding-footprint.md](DECISION-embedding-footprint.md)** — Embedding
  footprint decision record.
- **[token_optimization.md](token_optimization.md)** /
  **[token_optimization_short.md](token_optimization_short.md)** — Token-cost analysis.

## Build process & history

- **[POC_IMPLEMENTATION.md](POC_IMPLEMENTATION.md)** — Ground-up build sequence.
- **[IMPLEMENTATION_ESTIMATE.md](IMPLEMENTATION_ESTIMATE.md)** — Phased estimate.
- **[BUILD_LOG.md](BUILD_LOG.md)** — What was actually built.
- **[BUILD_PROMPTS.md](BUILD_PROMPTS.md)** — Per-phase kickoff prompts.
- **[SELF_DOCUMENTATION.md](SELF_DOCUMENTATION.md)** — Self-documentation architecture.

## Roadmap, packaging, migration record

- **[DEFERRED.md](DEFERRED.md)** — ⭐ The single "what was I supposed to do eventually?"
  index: every deferred item + what it's blocked on. Start here.
- **[V2_ROADMAP.md](V2_ROADMAP.md)** — Post-v1 backlog (Track A/B, open questions).
- **[DAEMON_LIFECYCLE.md](DAEMON_LIFECYCLE.md)** — Open question: should the daemon run
  constantly? (cost, options, the session-detection catch).
- **[VERSIONING.md](VERSIONING.md)** — SemVer-in-manifests, 0.x-until-verified-1.0 scheme.
- **[PACKAGING.md](PACKAGING.md)** — v1.1 distribution / GitHub-install plan + acceptance
  spec.
- **[MIGRATION_LESSONS.md](MIGRATION_LESSONS.md)** — Friction log from the automation
  dogfood (the real-use bugs + fixes).
- **[MIGRATION_KICKOFF.md](MIGRATION_KICKOFF.md)** — Paste-ready migration kickoff prompt.

## External design reviews

- **[opus_feedback.txt](opus_feedback.txt)** — Opus design review (the metrics critique).
- **[gpt_feedback.md](gpt_feedback.md)** — GPT design review.
