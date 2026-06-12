# POC Implementation Order

This document outlines the ground-up build sequence for the contextus POC, from first script to working prototype.

## Philosophy

Build in vertical slices that prove core assumptions early. Each phase should produce something you can run and validate before moving to the next.

**Critical path**: Prove retrieval works → Prove quality measurement works → Polish UX

---

## Phase 0: Hello World (Complete ✓)

**Goal**: Prove the full ingestion → retrieval pipeline works at all

**Location**: `poc/ingest-test.ts`

**What it does**:
1. Scan `.claude/context/` for markdown files
2. Generate embeddings via Transformers.js (nomic-embed-text-v1.5)
3. Store in ChromaDB collection
4. Query test: verify retrieval returns relevant patterns

**Success criteria**:
- Script runs without errors
- Query for "error handling" returns error-handling.md with high similarity
- Similarity scores make intuitive sense (relevant docs > 0.7, irrelevant < 0.5)

**Validates**:
- Transformers.js embedding pipeline works
- ChromaDB storage/retrieval works
- Similarity scores are meaningful

**Run**: `npx tsx poc/ingest-test.ts`

**Dependencies**: `npm install chromadb glob @xenova/transformers @types/node`

---

## Phase 1: Basic Injection Loop

**Goal**: Get context auto-injected into Claude prompts

**Components**:
1. **Daemon** (`daemon/server.ts`) — minimal HTTP server
   - POST `/embed` — generate embedding for query
   - POST `/query` — return top-K patterns above threshold
   - Pre-loads embedding model on startup
   - Serves one project for POC (hardcode path)

2. **UserPromptSubmit hook** (`hooks/user-prompt-submit.js`)
   - Query daemon with user's prompt
   - Inject top 3 patterns into user message (bracketed format)
   - Write injected pattern IDs to session state file

3. **Session state** (`~/.contextus/.session-state.json`)
   - Store: `{project, injected_patterns: [{id, snippet}], timestamp}`
   - Written by hook, read by eval worker (Phase 2)

**Success criteria**:
- Type a prompt → see retrieved patterns injected before your question
- Claude's response references the injected patterns
- Manually verify patterns are relevant

**Validation**:
- Dogfooding: use contextus while building contextus
- Does injection actually help? (gut check, not measured yet)

**Open questions to resolve**:
- What's the injection format? (use decision_injection_format.md as spec)
- What threshold? (start with 0.7, measure distribution)
- How many patterns? (start with 3, measure if budget is hit)

---

## Phase 2: Quality Measurement

**Goal**: Prove we can measure whether injected context was useful

**Components**:
1. **Stop hook** (`hooks/stop-evaluation.js`)
   - Fires after each Claude response
   - Reads: `user_message`, `assistant_message`, `preceding_reasoning`
   - Reads session state (injected patterns from last turn)
   - Writes eval job to queue: `~/.contextus/.eval-queue.jsonl`
   - Exits immediately (zero latency)

2. **Eval worker** (`daemon/eval-worker.js`)
   - Watches `.eval-queue.jsonl` for new jobs
   - Calls Haiku with evaluation prompt (see DESIGN_QUESTIONS.md Q12 for rubric)
   - Parses "1:helpful 2:unused 3:critical" format
   - Logs calibration_eval event to `usage.jsonl`
   - Tracks sample count, auto-disables after 100

3. **Calibration mode** (config flag)
   - `~/.contextus/config.json`: `{"calibration": {"enabled": true, "targetSamples": 100}}`
   - Stop hook checks flag before queuing eval jobs
   - Worker increments sample count, disables when target reached

**Success criteria**:
- Run 20-30 prompts with calibration enabled
- Review `usage.jsonl` calibration_eval events
- Do Haiku's ratings match your intuition?
- Do thinking blocks clearly reference retrieved patterns?

**Validates**:
- Stop hook provides sufficient context for evaluation
- Thinking blocks make "was this used?" answerable
- Haiku can reliably rate pattern usefulness
- Evaluation rubric (Question 12) produces consistent ratings

**Open questions to resolve**:
- Is Haiku good enough, or do we need Sonnet? (compare on 20 samples)
- Are rating definitions clear? (critical/helpful/mentioned/unused)
- False positive rate for "mentioned"? (did Claude use it, or just echo it?)

---

## Phase 3: User-Facing Tools

**Goal**: Make the system observable and tunable

**Components**:
1. **`/context-status` skill**
   - Read `usage.jsonl`, calculate stats
   - Show: injection rate, retrieval count, last calibration date
   - Detailed mode: show injectionFloor, skipped prompts, efficiency metrics
   - Spec: `skills/context-status/SKILL.md`

2. **`/context-calibrate` skill**
   - `--start`: enable calibration mode, reset sample count
   - `--report`: show weighted quality scores, zero-hit patterns
   - `--stop`: disable calibration mode
   - Spec: `skills/context-calibrate/SKILL.md`

3. **Logging infrastructure** (`daemon/logger.ts`)
   - Write structured events to `~/.contextus/usage.jsonl`
   - Event types: injection, retrieval, calibration_eval, correction_detected (v2)
   - Spec: `docs/LOGGING.md`

**Success criteria**:
- `/context-status` shows accurate injection rate and last calibration
- `/context-calibrate --start` enables eval, `/context-calibrate --report` shows scores
- Logs are parseable and contain expected fields

**Validates**:
- Metrics framework is useful (not just vanity numbers)
- Calibration workflow is understandable
- System is transparent (no black box magic)

---

## Phase 4: Multi-Project Support

**Goal**: Serve multiple projects from one daemon

**Changes**:
1. **Project slug derivation** (DESIGN_QUESTIONS.md Q3)
   - `deriveProjectSlug(cwd)` → basename with hash on collision
   - ChromaDB collections: `~/.contextus/data/{project-slug}/`

2. **Daemon query parameter**
   - Hook sends: `POST /query?project=automation`
   - Daemon loads correct collection

3. **Session state per-project**
   - One global file, stores `{project, injected_patterns}`
   - Hook writes project from `process.cwd()`

**Success criteria**:
- Switch between two projects → each gets correct context
- Collections don't interfere (automation != contextus)

---

## Phase 5: Robustness

**Goal**: Handle errors gracefully, support real-world usage

**Enhancements**:
1. **Daemon auto-start** (DESIGN_QUESTIONS.md Q4)
   - Hook checks health endpoint before query
   - If down: spawn daemon, retry with backoff
   - Max 3 retries → fall back to no-injection mode

2. **Embedding model validation**
   - Collection metadata stores `embedding_model`
   - Query checks model matches, errors if mismatch
   - Prompt: `/rebuild-embeddings` to fix

3. **Injection budget**
   - Track token count, cap at 3k (DESIGN_QUESTIONS.md Q5)
   - Log dropped patterns when budget exceeded

4. **Stale collection detection**
   - Check `.claude/context/` mtime vs collection mtime
   - Warn if files changed: "Context out of sync, run `/context-rebuild`"

**Success criteria**:
- Daemon crash → recovers automatically
- Model mismatch → clear error message
- Files added → system prompts rebuild

---

## Deferred to Post-POC

These are good ideas but not critical for validating core assumptions:

- Pattern compression (v2: DESIGN.md)
- Per-category thresholds (v2: DESIGN_QUESTIONS.md Q13)
- Harmful stale detection (v2: DESIGN_QUESTIONS.md Q11)
- Adaptive injection floor (v2: DESIGN_QUESTIONS.md Q13)
- `/context-doctor` troubleshooting tool
- Dashboard web UI

---

## Key Validations

Throughout POC, explicitly check these assumptions:

1. **Does injection help?** (Phase 1)
   - Manually verify Claude's responses are better with context
   - Track before/after comparisons on identical prompts

2. **Do similarity scores make sense?** (Phase 0, 1)
   - Relevant patterns > 0.7, irrelevant < 0.5
   - If threshold needs adjustment, measure distribution first

3. **Is 3k token budget sufficient?** (Phase 1)
   - Measure average pattern length
   - Track how often budget is hit

4. **Can Haiku evaluate quality?** (Phase 2)
   - Compare Haiku vs your own rating on 20 samples
   - Check inter-rater reliability (run same eval twice)

5. **Do thinking blocks reference context?** (Phase 2)
   - Check if Claude explicitly says "the retrieved pattern X shows..."
   - If not, injection format may need tuning

6. **Is injection floor right at 0.7?** (Phase 1, 2)
   - Measure similarity distribution of retrieved patterns
   - Check if patterns below 0.7 are actually useful

---

## Success Metrics

**Phase 1 success**: You dogfood contextus and it helps (subjective, but critical)

**Phase 2 success**: Calibration reports weighted score > 0.6 (patterns are used more than ignored)

**Phase 3 success**: You run `/context-status` and understand the numbers

**Overall POC success**: You can honestly say "proactive context injection makes Claude better at this project"

If any phase fails to meet success criteria, stop and diagnose before continuing. No point building polish on top of a system that doesn't work.
