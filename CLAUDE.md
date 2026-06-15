# claude-contextus

**Proactive context delivery system for Claude Code**

Stop searching for context — let it find you. Automatic semantic retrieval of project patterns from `.claude/context/` with zero-query injection.

## Project Status

**Phase**: Design complete, ready for implementation  
**Next**: POC implementation (daemon + basic retrieval)

## Key Design Decisions

All major architectural decisions are documented in:
- `docs/dev/DESIGN.md` — Complete system architecture (16 settled decisions)
- `docs/dev/DESIGN_QUESTIONS.md` — Implementation decisions with recommendations
- `docs/dev/LOGGING.md` — Dual-format logging schema (analytics + human-readable)
- `.claude/memory/` — Critical design decisions and feedback

**Core principles** (do not re-litigate):
1. **Proactive delivery over search** — Context injected automatically, not on-demand
2. **Quality over vanity metrics** — Calibration evaluates actual usage, not token savings
3. **Capture modes are permanent tradeoffs** — `propose`/`auto`/`silent` are choices, not a ramp
4. **Injection floor is critical** — Not every prompt should receive context
5. **Haiku for evaluation** — Proven reliable, 10× cheaper than Sonnet
6. **User message prepend** — Front-loads context for better attention
7. **File-based session state** — `~/.contextus/.session-state.json`
8. **Auto-start daemon with recovery** — 3 retries, exponential backoff

## What Makes This Different from claude-mem

| Feature | contextus | claude-mem |
|---------|-----------|------------|
| **Purpose** | Inject curated patterns | Track activity history |
| **Source** | Hand-written `.claude/context/` | Auto-generated observations |
| **Retrieval** | **Automatic** (every prompt) | **Manual** (`/mem-search`) |
| **UX** | Proactive, ambient | Reactive, explicit |
| **Storage** | `~/.contextus/data/` (file-based) | Server-based |

**They complement each other**: contextus = normative patterns, claude-mem = observational history

## Implementation Priorities

**v1 (beach implementation)**:
- ✅ Daemon architecture documented
- ✅ Metrics framework redesigned
- ✅ Evaluation infrastructure specified
- 🚧 Core daemon (embedding + retrieval)
- 🚧 UserPromptSubmit hook (inject context)
- 🚧 Stop hook + eval worker
- 🚧 Session state storage

**v2** (after POC validation):
- Pattern compression
- Dedup checking (LLM-based)
- Per-category thresholds
- Advanced re-ranking

**v3** (future):
- Hybrid semantic + keyword search
- Context versioning
- Collaborative corpus sharing

## Quick Reference

**Key Files**:
- `docs/dev/DESIGN.md` — Architecture
- `docs/dev/DESIGN_QUESTIONS.md` — Open questions with recommendations
- `docs/dev/opus_feedback.txt` — External design review (critical metrics critique)
- `hooks/stop-evaluation.js` — Calibration evaluation hook
- `daemon/eval-worker.js` — Background quality measurement
- `skills/context-calibrate/` — Quality measurement and optimization

**Commands** (once implemented):
- `/context-status` — Health dashboard
- `/context-calibrate --start` — Begin quality evaluation (100 samples)
- `/context-calibrate --report` — View calibration results
- `/context-doctor` — Troubleshoot issues

**Design Validation Needed** (during POC):
- Does user message prepend make thinking reference context clearly?
- Is 3k token budget sufficient? (measure average pattern length)
- Is 0.7 similarity threshold appropriate? (model-dependent)
- Does Haiku handle evaluation quality well? (compare vs Sonnet on 20 samples)

## Working with This Codebase

**Documentation hierarchy**:
1. **CLAUDE.md** (this file) — Project overview and quick reference
2. **docs/dev/DESIGN.md** — Authoritative architecture spec
3. **docs/dev/DESIGN_QUESTIONS.md** — Implementation decisions
4. **`.claude/memory/`** — Design decisions and feedback (searchable)
5. **Commit messages** — Design decision records

**When implementing**:
- Read DESIGN.md for architectural constraints
- Check DESIGN_QUESTIONS.md for implementation guidance
- Validate assumptions marked "🔍 Validate" in DESIGN_QUESTIONS.md
- Use `/create-memory` to capture learnings
- Use `/investigation-complete` after solving problems

**When documenting discoveries**:
- Design decisions → `.claude/memory/decision_*.md`
- Implementation patterns → `.claude/context/` (once contextus is working!)
- Comprehensive guides → `docs/`

## Critical Context

**Opus's Design Review** (docs/dev/opus_feedback.txt):

The most important feedback: "Tokens saved" is a vanity metric. It measures against wrong baseline (full-file injection vs inject-nothing). Real quality = did Claude **use** the retrieved patterns?

**Our response**: Shifted entire metrics framework:
- Demoted "tokens saved" to efficiency metric
- Added calibration evaluation (explicit quality ratings)
- Stop hook + thinking blocks make evaluation tractable
- Haiku evaluates as critical/helpful/mentioned/unused

**Why this matters**: We were optimizing a pipeline around a number that couldn't tell us if the system worked.

**Related memories**: [[opus-metrics-critique]], [[evaluation-architecture]], [[ollama-model-quality]]

## Team Context

**Claude's Role**: Treat this as senior-level technical collaboration
- Approach problems with deep knowledge of AI systems, RAG architectures, memory/context systems, and vector databases
- Discuss semantic search internals, embedding model trade-offs, and retrieval optimization patterns directly
- Focus on implementation details, architectural trade-offs, and practical design constraints
- Value working code over theoretical perfection — POC first, polish later
- Direct technical communication, skip the basics

**Hardware**: Developers have M4 Pro 48GB (excellent for local inference)
- Makes Ollama viable for evaluation (privacy, zero cost)
- But validate quality against Haiku baseline first
- Llama 8B showed poor semantic eval quality in vector-inspector

**Workflow preferences**:
- File-based everything (session state, configs, logs)
- Auto-start with recovery (manual start is friction)
- Transparency over automation (log dropped patterns, show what was skipped)
- Direct technical communication (no hand-holding, no over-explaining)

## Skills Available

Global skills (work in all projects):
- `/create-memory` — Document design decisions with validation
- `/create-doc` — Comprehensive documentation in `docs/`
- `/audit-memory` — Review memories for duplicates and staleness
- `/memory-reminder` — Prompts to document discoveries
- `/investigation-complete` — Post-debugging checklist
- `/work-complete` — Unified completion workflow
- `/refactor-symbol` — TypeScript LSP integration
- `/lint` — Intelligent linting with auto-fix

Project-specific skills:
- `/context-status` — System health dashboard (once implemented)
- `/context-calibrate` — Quality measurement (once implemented)
- `/context-doctor` — Troubleshooting (once implemented)

## Known Issues / Open Questions

See `docs/dev/DESIGN_QUESTIONS.md` for complete list.

**High priority validations during POC**:
1. Does thinking explicitly reference injected context? (validates injection format)
2. What's the actual similarity score distribution? (validates 0.7 threshold)
3. Can Haiku reliably evaluate quality? (compare vs Sonnet on sample)
4. Do we hit 3k token budget often? (measure pattern lengths)

## Related Projects

- **claude-mem** — Session memory and observations (different purpose, complementary)
- **vector-inspector** — Embedding visualization tool (user's previous project, informed Ollama quality assessment)

---

**Ready to implement!** Design is solid, open questions are "validate during POC" not "decide before starting."

Beach coding starts tomorrow 🏖️
