# Design Request: Usage Feedback Loop (Phases 1-3)

**Context:** You are designing the usage feedback system for claude-contextus, a proactive context injection plugin for Claude Code. Right now contextus retrieves and injects context automatically, but has no feedback loop to know what's actually useful. This design will unblock all Track B roadmap items.

---

## Your Task

Write a comprehensive design document (`docs/dev/USAGE_FEEDBACK_LOOP.md`) covering three implementation phases:

1. **Phase 1: Stop Hook + Usage Evaluation** — Capture what context was injected and whether Claude actually used it
2. **Phase 2: Analytics + Health Tooling** — Build observability (stats, review, doctor commands)
3. **Phase 3: Curation Workflows** — Usage-driven promotion, staleness detection, duplicate cleanup

The design must be **implementation-ready** for Sonnet to build from (file paths, function signatures, config schema, prompt templates, logging format).

---

## Background: Why This Matters

**The problem:** Contextus retrieves context based on semantic similarity, but has no signal about whether that context was useful. This causes:
- Can't distinguish high-value patterns (promote to always-on rules) from noise (archive or remove)
- Can't detect stale patterns (not retrieved in 6 months) vs. ignored patterns (retrieved but unused)
- Evidence-driven category taxonomy (line 57, V2_ROADMAP.md) throws away rejection signals

**The solution:** A feedback loop that tracks:
1. What context was retrieved (already logged)
2. What context was injected (already logged)
3. **What context was used** (missing — this is Phase 1)

**Prior art:**
- Observations S80-S81 (2026-06-12): designed quality gradient ratings (critical/helpful/mentioned/unused) for RLHF-style feedback
- Observations S78-S82 (2026-06-12): redesigned metrics to focus on "honest usage quality" instead of token-compression vanity metrics
- Self-improving-agent skill (analyzed 2026-06-24): promotes patterns from auto-memory → CLAUDE.md based on usage frequency

**Key insight from S80:** "Post-prompt usage evaluation to collect statistically significant usage data without always-on overhead, replacing continuous footer parsing approach."

---

## What You're Designing

### Phase 1: Stop Hook + Usage Evaluation

**Goal:** Capture usage ratings for injected context chunks.

**Mechanism:** SessionStop hook fires after Claude's response. It should:
1. Read the response from the session transcript
2. Extract the list of injected context IDs (from provenance footer or daemon log)
3. Call Haiku with a prompt: *"This context was injected. How much did it contribute to the response? Rate: critical / helpful / mentioned / unused."*
4. Log the ratings to `~/.contextus/data/<project>/usage.jsonl`

**What you must specify:**
- **Hook script:** `scripts/hooks/SessionStop.js` — what it reads (transcript? daemon log?), what it calls (daemon endpoint? direct Haiku?), error handling (failed eval = log warning, don't block)
- **Evaluation prompt:** Full template for Haiku. Input: (context chunk text, user prompt, Claude's response). Output: rating + reasoning.
- **Logging schema:** `usage.jsonl` format. One line per chunk per query. Fields: `timestamp`, `sessionId`, `chunkId`, `filename`, `category`, `rating`, `reasoning`, `retrievalScore`, `injected` (boolean).
- **Config:** New section in `plugin.jsonc` — `usageEvaluation: { enabled: boolean, provider: "bedrock-haiku" | "ollama", model: string, samplingRate: number }`. Default: enabled, 100% sampling (can tune down later if cost is an issue).
- **Cost model:** Haiku call per injected chunk. Estimate: 3-5 chunks per query × $0.0003 per chunk = ~$0.001/query. Acceptable?
- **Calibration mode:** Should this only run in calibration mode (explicitly enabled), or always-on? S80 says "calibration mode without always-on overhead," but contextus design (S82) leans toward always-on for continuous feedback. Decide and justify.

**Dependencies:**
- Bedrock Haiku provider (already exists in expansion fallback)
- SessionStop hook infrastructure (exists, needs script)
- Daemon `/query` endpoint already logs what was injected (check `lib/logging.ts`)

**Open questions you must answer:**
- How does the hook get the list of injected chunks? Parse `query-log.jsonl`? New daemon endpoint `GET /last-query`?
- What if the user types `/clear` mid-session (transcript deleted)? Graceful degradation.
- What if evaluation fails (Haiku down, timeout)? Log the failure, continue silently.
- Should ratings be written by the hook (direct file write) or posted to the daemon (`POST /usage-rating`)? Daemon-mediated is more consistent with capture endpoint design (PR #12).

---

### Phase 2: Analytics + Health Tooling

**Goal:** Make usage data actionable via CLI commands.

**Skills to design:**

#### `/context-stats`

Display retrieval + usage analytics. Output format (markdown table):

```
## Retrieval Analytics (last 30 days)

Total Queries: 847
Avg Chunks Injected: 3.2
Total Cost (eval): $0.82

## Top 10 Most Useful
| File | Category | Retrieved | Avg Rating | Critical% |
|------|----------|-----------|------------|-----------|
| gotcha-react-state-stale-closure.md | gotcha | 52 | 2.8 | 67% |
| ...

## Never Retrieved (potential stale)
| File | Category | Last Modified | Age |
|------|----------|---------------|-----|
| reference-old-api-deprecated.md | reference | 2025-11-03 | 7mo |
| ...

## High Retrieval, Low Usage (noisy patterns)
| File | Category | Retrieved | Avg Rating |
|------|----------|-----------|------------|
| pattern-overly-broad.md | pattern | 38 | 0.4 |
| ...
```

**What you must specify:**
- Aggregation queries over `usage.jsonl` (avg rating, retrieval count, last-seen timestamp)
- Time window: default 30d, `--all` flag for full history
- JSON export: `--json` flag for scripting
- Implementation: Node.js script (`scripts/cli/context-stats.ts`) or daemon endpoint (`GET /stats`)?

#### `/context-review`

Surface high-usage patterns for promotion. Prompt user to promote to:
- **CLAUDE.md** (always-loaded, highest precedence)
- `.claude/memory/` (persistent patterns, medium precedence)
- Do nothing (leave in `.claude/context/`)

**Sorting:** By usage score (weighted: critical=3, helpful=2, mentioned=1, unused=0). Show top 10 candidates.

**Output format:**
```
## Promotion Candidates

1. **gotcha-react-state-stale-closure.md** (gotcha)
   - Retrieved: 52 times
   - Avg Rating: 2.8 (67% critical, 25% helpful)
   - Why: Consistently rated critical; addresses recurring bug pattern

   Promote to:
   [1] CLAUDE.md (always loaded)
   [2] .claude/memory/ (persistent pattern)
   [3] Skip

   > [user types 1]

   ✓ Promoted to CLAUDE.md
   Suggested insertion point: ## Project Patterns > React
```

**What you must specify:**
- Promotion threshold: min retrieval count? min avg rating?
- How to write to CLAUDE.md: append to end? insert under a section? prompt user for placement?
- How to write to `.claude/memory/`: convert frontmatter (context → memory schema)? pick memory type (feedback/reference/project)?
- Git workflow: stage the file, or prompt user to commit?

#### `/context-doctor`

Health report + automated fixes. Extends Track C line 88 with usage-driven checks.

**Checks:**
1. Daemon alive? (`GET /health`)
2. Model loaded? (warmup success)
3. Corpus non-empty? (LanceDB row count > 0)
4. Config matches meta? (embedding provider matches `<project>.lance-meta.json`)
5. Linked projects reachable? (stat each linked path)
6. **Duplicate contexts?** (content-hash collision, different filenames)
7. **Stale patterns?** (not retrieved in 6mo, or retrieved but always unused)

**Output format:**
```
## Contextus Health Report

✓ Daemon running (PID 12345)
✓ Model loaded (nomic-embed-text via transformers.js)
✓ Corpus: 428 chunks across 87 files
✗ 3 duplicate contexts detected
✗ 12 stale patterns (not retrieved in 6mo)
⚠ 5 noisy patterns (retrieved but avg rating < 0.5)

## Recommended Fixes

1. Merge duplicate contexts:
   - workflow-deploy-checklist.md (decisions/)
   - deploy-steps.md (reference/)
   → Run: /merge-context decisions/workflow-deploy-checklist.md reference/deploy-steps.md

2. Archive stale patterns:
   → Run: /archive-context --stale

3. Review noisy patterns:
   → Run: /context-review --filter noisy
```

**What you must specify:**
- Staleness definition: never retrieved? or retrieved but unused?
- Duplicate detection: exact content-hash match? or semantic similarity > 0.95?
- Automated fixes: which are safe to auto-apply vs. require confirmation?
- Implementation: Node.js script or daemon endpoint?

---

### Phase 3: Curation Workflows

**Goal:** Act on usage data — promote, archive, merge.

**Skills to design:**

#### `/promote-context <file>` (or batch via `/context-review`)

Promote a context file to a higher precedence layer.

**Targets:**
- `CLAUDE.md` — always-loaded, project-wide rules
- `.claude/memory/` — persistent patterns, cross-session
- (future) `.claude/rules/` — per-category overrides

**What you must specify:**
- Where in CLAUDE.md to insert? (append? under a section? prompt user?)
- How to convert frontmatter? (context schema → CLAUDE.md prose?)
- Should the original file be deleted, or left as-is? (Proposed: leave it — retrieval still works, but CLAUDE.md takes precedence)

#### `/archive-context <file>` or `--stale`

Move stale patterns to `.claude/context/.archive/`. Does NOT delete from LanceDB (row stays, but source path updated).

**What you must specify:**
- Archive criteria: `--stale` flag (not retrieved in 6mo)? `--unused` flag (avg rating < 0.3)?
- Should archived files still be retrievable? (Proposed: yes, but heavily downranked)
- Git workflow: stage the move, or auto-commit?

#### `/merge-context <file1> <file2> --output <merged>`

Merge duplicate or overlapping contexts. Haiku-assisted: read both files, propose merged content, user reviews.

**What you must specify:**
- Duplicate detection: invoked manually, or suggested by `/context-doctor`?
- Merge prompt: full template for Haiku
- What happens to original files? (delete? move to archive?)

#### `/tag-context` (existing skill, enhance)

Already exists. Enhancement: auto-suggest tags based on usage patterns.

**What you must specify:**
- If a context is frequently retrieved alongside another, suggest shared tags?
- If a context is always ignored (low rating), suggest `deprecated` tag?

---

## Design Constraints

**File-based everything:** No external services. Logs go to `~/.contextus/data/<project>/usage.jsonl`.

**Graceful degradation:** If Haiku is down, evaluation fails silently (log warning, don't block). Retrieval still works.

**Config hot-reload:** Usage evaluation config (`usageEvaluation.enabled`, `samplingRate`) should reload without daemon restart.

**Cost transparency:** `/context-stats --cost` should show eval spend (queries × chunks × Haiku rate).

**Propose, not auto:** Phase 3 workflows (promote, archive, merge) always prompt for confirmation. Never silently change files.

**Git is the quality gate:** Promoted/archived files appear in `git status`, user decides what to commit.

---

## What Sonnet Needs From You

For each phase, specify:

1. **Architecture:** What calls what? Hook → daemon → Haiku? Or hook → direct Haiku call?
2. **File paths:** Exact locations for new scripts, skills, log files.
3. **Schemas:** JSON formats for logs, config, API payloads.
4. **Prompts:** Full LLM prompt templates (Haiku evaluation, merge proposals).
5. **Config:** New sections in `plugin.jsonc`, per-project overrides in `.claude/contextus.jsonc`.
6. **Error handling:** What fails gracefully? What blocks the user?
7. **Cost model:** Haiku calls per query, estimated spend per month.
8. **Open questions:** Anything you can't decide alone (defer to user).

**Output:** Write `docs/dev/USAGE_FEEDBACK_LOOP.md` as a **buildable spec**, not a high-level outline. Sonnet should be able to start implementing Phase 1 immediately after reading it.

---

## Reference Material

Read these files first (they're already in your context via contextus):

- `docs/dev/V2_ROADMAP.md` — Track A/B items, dependencies
- `docs/dev/LOGGING_SCHEMA.md` — existing log formats (`query-log.jsonl`, `expansion-log.jsonl`)
- `docs/dev/SILENT_CAPTURE_V2.md` — capture modes, footer design
- `lib/config.ts` — config schema, merge logic
- `scripts/hooks/UserPromptSubmit.js` — existing hook pattern
- `daemon/server.ts` — existing endpoints (`/query`, `/capture`, `/health`)
- `.claude/context/decisions/decision-activity-triggered-retrieval.md` — related retrieval enhancement

**Observations to reference:**
- S78-S82 (2026-06-12): opus-metrics-critique, honest usage quality
- S80-S81 (2026-06-12): quality gradient ratings, calibration mode design

---

## Success Criteria

Your design is complete when:

1. Sonnet can implement Phase 1 in one session (Stop hook, eval prompt, logging)
2. Phase 2 skills have clear output formats and aggregation queries
3. Phase 3 workflows have defined promotion/archival rules
4. Cost model is transparent (Haiku calls, estimated spend)
5. Error handling is specified (fails gracefully, never blocks)
6. Config schema is backward-compatible (new fields default to safe values)

---

## Final Note: Understandability First

Contextus's strength is that it's **understandable**:
- File-based corpus (you can inspect `.claude/context/`)
- Transparent retrieval (provenance footer shows what was injected)
- Predictable (injection floor, retrieval logging)

Don't lose that. The usage feedback loop should:
- Log to files users can read (`usage.jsonl` is plain JSONL)
- Never auto-promote or auto-delete without confirmation
- Make the feedback loop **visible** (`/context-stats` shows what's working)

If a design choice adds significant complexity or makes the system harder to reason about, flag it as an open question. Prefer simple, transparent mechanisms over clever automation.

---

**Go.** Write the design doc Sonnet needs to build this.
