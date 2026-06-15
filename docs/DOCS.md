# Documentation Index

Comprehensive documentation for the contextus project. Design decisions, implementation guidance, and architectural philosophy.

---

## Core Architecture

- **[DESIGN.md](DESIGN.md)** — Complete system architecture with 16 settled decisions. Canonical reference for why choices were made and constraints that guide implementation.

- **[DESIGN_QUESTIONS.md](DESIGN_QUESTIONS.md)** — Pre-implementation decisions with recommendations. Questions marked ✅ Decided, 🚧 Partial, ❓ Open, or 🔍 Validate during POC.

- **[DESIGN ADDENDUM.md](DESIGN%20ADDENDUM.md)** — Supplementary design notes and extensions to the core architecture.

- **[LOGGING.md](LOGGING.md)** — Dual-format logging schema (analytics + human-readable). Documents event types including calibration_eval for quality measurement.

- **[CONTEXT_APPLICABILITY_EVALUATOR.md](CONTEXT_APPLICABILITY_EVALUATOR.md)** — CAE spec: the semantic gating layer between retrieval and injection. Runtime sub-agent prompt, scoring rubric, tag ontology seed set, execution flow, and the context removal/governance model (soft/hard/replacement removal).

- **[CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md)** — Rules for `.claude/context/` categories vs tags: how to choose a category, when a new one is justified, the `arch-`/`decision-`/`project-` distinctions, and how tags add a second semantic dimension.

---

## Implementation Guides

- **[POC_IMPLEMENTATION.md](POC_IMPLEMENTATION.md)** — Ground-up build sequence from first script to working prototype. Phases, success criteria, and validation steps.

- **[SELF_DOCUMENTATION.md](SELF_DOCUMENTATION.md)** — Three-layer self-documentation architecture: system auto-docs (introspection endpoints + `generate-docs`), minimal model phase-boundary logs, and context-as-documentation (`.claude/context/` prefixes, templates, dogfooding workflow).

- **[BUILD_PROMPTS.md](BUILD_PROMPTS.md)** — Copy-paste kickoff prompts for the v1 build, one per `/clear` cycle. Maps each phase to a ready-to-run prompt with its stop/verify seam.

- **[IMPLEMENTATION_ESTIMATE.md](IMPLEMENTATION_ESTIMATE.md)** — Effort estimates (engineer-days + AI wall-clock/token cost), scaffolding reality check, unit testing strategy, and a recommended 7-phase build order with exit criteria.

- **[BUILD_LOG.md](BUILD_LOG.md)** — Per-phase completion summaries appended at each build stop: what changed, what was verified vs. needs user verification, DESIGN.md divergences, decisions applied, and token/cost. The durable record of what was *actually built*.

- **[V2_ROADMAP.md](V2_ROADMAP.md)** — Post-v1 feature backlog: CAE gate, tag-driven gating, removal/governance, corpus reconciliation, full auto-docs, and open design questions. Items deliberately deferred from v1.

- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — Migrating an existing custom-hooks + `.claude/memory/` setup to contextus: audit, migrate-memory, hook hygiene (settings.json), live-session testing, coexistence period, rollback. Includes the `/contextus-migrate` skill sketch.

- **[MIGRATION_KICKOFF.md](MIGRATION_KICKOFF.md)** — Paste-ready kickoff prompt for the automation-project migration: the two-location split (drive from contextus repo, validate live from the automation repo), the blocker/friction/smooth/discovery capture protocol, and feedback-into-docs loop.

- **[PACKAGING.md](PACKAGING.md)** — Distribution (v1.1): why `--plugin-dir` is the supported personal pattern today, why GitHub-marketplace install needs work (no auto npm install, ephemeral plugin root, native deps), and the documented `SessionStart`→`${CLAUDE_PLUGIN_DATA}` install pattern + drop-tsx plan to get there.

---

## Design Philosophy

- **[token_optimization.md](token_optimization.md)** — Why contextus optimizes meaning, not tokens. Explains the injection floor as the primary optimization lever and why model quality works in your favor.

- **[token_optimization_short.md](token_optimization_short.md)** — Condensed version with diagram. Key insight: "Once meaning is preserved, further token shrinking doesn't matter." README-ready content.

---

## Design Decisions

- **[DECISION-embedding-footprint.md](DECISION-embedding-footprint.md)** — Decision record on embedding model selection and storage footprint considerations.

---

## External Design Reviews

- **[opus_feedback.txt](opus_feedback.txt)** — Critical design review from Opus. Core insight: "tokens saved" is a vanity metric; measure whether injected context was **used**, not just injected.

- **[gpt_feedback.md](gpt_feedback.md)** — Additional design feedback and considerations.

---

## Document Types

**Architecture docs** (DESIGN.md, LOGGING.md):
- Authoritative specifications
- Design constraints and trade-offs
- Reference for implementation decisions

**Decision records** (DECISION-*.md):
- Point-in-time choices with rationale
- Alternatives considered and rejected
- Links to related decisions

**Implementation guides** (POC_IMPLEMENTATION.md):
- Step-by-step build sequences
- Success criteria and validation
- Open questions to resolve during implementation

**Philosophy docs** (token_optimization*.md):
- Core principles that justify design choices
- Why the system works without heavy tuning
- Key insights for communicating to users

**External reviews** (opus_feedback.txt, gpt_feedback.md):
- Critical perspectives on design
- Caught issues before implementation
- Validated or challenged assumptions

---

## Quick Links

**Starting implementation?** Read [POC_IMPLEMENTATION.md](POC_IMPLEMENTATION.md) → [DESIGN.md](DESIGN.md) → [DESIGN_QUESTIONS.md](DESIGN_QUESTIONS.md)

**Understanding why contextus works?** Read [token_optimization_short.md](token_optimization_short.md)

**Validating a design choice?** Check [DESIGN.md](DESIGN.md) settled decisions, then search [DESIGN_QUESTIONS.md](DESIGN_QUESTIONS.md)

**Building quality measurement?** Read [LOGGING.md](LOGGING.md) calibration_eval events, review [opus_feedback.txt](opus_feedback.txt) metrics critique
