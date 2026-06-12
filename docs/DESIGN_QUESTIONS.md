# Design Questions

Open questions and decisions needed before/during implementation.

## Status Legend
- ✅ **Decided** — Design choice made, documented
- 🚧 **Partial** — Some aspects decided, details TBD
- ❓ **Open** — Needs decision during implementation
- 🔍 **Validate** — Decision made, needs validation during POC

---

## 1. Session State Mechanism ✅

**Question**: How does Stop hook retrieve "injected patterns from session state"?

**Decision**: File-based session state
- **Where**: `~/.contextus/.session-state.json`
- **Lifetime**: Per-session (cleared on session end or next prompt)
- **Scope**: Global (one file, stores current project context)
- **Format**:
  ```json
  {
    "project": "/Users/Anthony.Dawson/src/automation",
    "injected_patterns": [
      {"id": "logger-helper", "snippet": "Log retry attempts..."},
      {"id": "test-data-setup", "snippet": "Use fixtures..."}
    ],
    "timestamp": "2026-06-12T14:23:42Z"
  }
  ```

**Implementation**: 
- UserPromptSubmit writes state after injection
- Stop hook reads state, then clears it
- File lock not needed (single-threaded hook execution)

**Already implemented in**: `hooks/stop-evaluation.js` (line 21)

---

## 2. UserPromptSubmit Injection Format ✅

**Question**: How does context get injected into Claude's prompt?

**Decision**: User message prepend with bracketed framing

**Format**:
```
[Retrieved from your project's context patterns - reference these if relevant]

---
**logger-helper.md** (similarity: 0.87, used 12 times)
Log retry attempts for debugging flaky tests...

---
**test-data-setup.md** (similarity: 0.81, used 9 times)
Use fixtures to isolate test state...

---

{user's actual prompt}
```

**Rationale**:
- ✅ **Front-loaded**: Context appears before question (primacy effect, better attention)
- ✅ **Clear framing**: Bracket distinguishes retrieved resources from user's words
- ✅ **Closer to prompt**: Spatially near the question it's meant to answer
- ✅ **Visible to thinking**: Claude will naturally reference "the retrieved context patterns"
- ✅ **User message > system prompt**: Gets more attention in practice
- ✅ **Metadata exposed**: Similarity and hit count visible for Claude to reason about

**Bracket does critical work**:
- Prevents confusion about what the user is asking vs what was retrieved
- Sets expectation: "reference *if relevant*" (not "you must use these")
- Makes it obvious this is injected, not user-written

**Validation**: Check early thinking blocks to confirm Claude references context naturally (e.g., "Looking at the retrieved patterns, logger-helper.md shows...")

---

## 3. Multi-Project Daemon Coordination 🚧

**Question**: Single daemon serves all projects — how does it know which project's context to query?

**Partial answer**: Working directory
- Hook execution provides `process.cwd()` as project root
- Daemon query includes `project` parameter
- ChromaDB path: `~/.contextus/data/{project-slug}/`

**Open detail**: How to derive project slug?

**Decision**: Base directory name with hash suffix on collision

**Algorithm**:
```typescript
function deriveProjectSlug(absolutePath: string): string {
  const basename = path.basename(absolutePath);
  const existingProjects = listExistingProjects(); // scan ~/.contextus/data/
  
  // No collision? Use clean name
  if (!existingProjects.some(p => p.startsWith(basename))) {
    return basename;
  }
  
  // Collision detected, add hash suffix
  const hash = crypto.createHash('sha256')
    .update(absolutePath)
    .digest('hex')
    .substring(0, 8);
  
  return `${basename}-${hash}`;
}
```

**Examples**:
- `/Users/Anthony/src/automation` → `automation`
- `/Users/Anthony/work/automation` → `automation-a3f5c9d2` (collision detected)
- `/Users/Anthony/src/backend` → `backend`

**Rationale**:
- Clean names (`automation`, `backend`) for common case
- Automatic collision avoidance without config
- Deterministic (same path → same slug)
- User can still override via `.claude/contextus.json` if desired

**Already specified in**: DESIGN.md line 32 (storage location), need to formalize slug derivation

---

## 4. Daemon Lifecycle & Crash Handling ✅

**Question**: How does daemon start, stop, and recover?

**Decision**: Auto-start with recovery

**Start**:
- First `/context-*` command or UserPromptSubmit hook checks if daemon running
- If not: spawn daemon process, wait for health check
- Daemon binds to `localhost:8765` (configurable)

**Health Check**:
- Hook calls `http://localhost:8765/health` before each query
- If fails: log error, attempt restart (max 3 retries)
- If restart fails: fall back to no-injection mode, log warning

**Stop**:
- Daemon idles out after 30 minutes of no activity
- Or explicit `/context-stop` command
- Graceful shutdown (finish in-flight queries)

**Crash Recovery**:
- Hooks detect crash via failed health check
- Auto-restart with exponential backoff (100ms, 200ms, 400ms)
- After 3 failures: disable for session, notify user

**Persistence**: Daemon state (loaded models, collections) lost on crash, rebuilt on restart

**Already specified in**: DESIGN.md "Daemon Lifecycle" section, need to formalize auto-start trigger

---

## 5. Injection Content Length Limits ✅

**Question**: What if retrieved patterns exceed token budget?

**Decision**: Smart cap with transparency (3k token budget, ranked injection)

**Algorithm**:
```typescript
const INJECTION_BUDGET = 3000;
let tokensUsed = 0;
const injected = [];

for (const pattern of rankedPatterns) {
  const tokens = estimateTokens(pattern.content);
  
  if (tokensUsed + tokens > INJECTION_BUDGET) {
    const dropped = rankedPatterns.length - injected.length;
    log(`Reached ${INJECTION_BUDGET} token budget, dropped ${dropped} lower-ranked patterns`);
    break;
  }
  
  injected.push(pattern);
  tokensUsed += tokens;
}
```

**Rationale**:
- **Deterministic**: Highest-ranked patterns always make it (re-ranking is meaningful)
- **Transparent**: Log shows what was dropped and why
- **Simple**: No compression complexity (deferred to v2)
- **Reasonable scale**: If average pattern is ~300 tokens, budget fits ~10 patterns

**Fallback rejected**: Compression adds 200ms+ latency (Haiku call) and risk of losing critical details

**Validation needed**: During POC, measure:
- Average pattern length in real corpus
- How often budget is hit (if >20% of retrievals, consider raising budget or lowering topK)
- Quality impact of dropped patterns (does hit count drop for bottom-ranked?)

---

## 6. Context Pattern Discovery 🚧

**Question**: How does daemon discover which files to index?

**Partial answer**: Configurable sources
- `.claude/context/` (always scanned)
- `docs/` (opt-in)
- `~/.claude/context/` user patterns (always scanned)
- Custom paths via config

**Open detail**: Should we auto-detect common doc locations?
- `README.md`, `CONTRIBUTING.md` at project root?
- `docs/`, `documentation/`, `.github/`?
- Risk: indexing irrelevant files, noise in corpus

**Decision**: Start with explicit sources only, add auto-detection if users request

**Already specified in**: DESIGN.md "Document Sources" section

---

## 7. Embedding Model Loading ✅

**Question**: Does daemon pre-load embedding model, or lazy-load on first query?

**Decision**: Pre-load on daemon start

**Rationale**:
- Avoids 5-10s first-query latency
- Model warm-up is one-time cost
- Daemon restart is infrequent

**Implementation**: Daemon startup sequence:
1. Load config
2. Initialize embedding model (nomic-embed-text-v1.5)
3. Warm up with dummy embedding
4. Bind HTTP server
5. Signal ready via health endpoint

**Already specified in**: DESIGN.md "Daemon Architecture" section

---

## 8. Collection Metadata Validation 🔍

**Question**: What if ChromaDB collection was built with different embedding model?

**Decision**: Validate on every query, error + rebuild prompt if mismatch

**Implementation**:
```typescript
const collection = await getCollection(project);
const storedModel = collection.metadata.embedding_model;

if (storedModel !== currentModel) {
  throw new Error(
    `Collection built with ${storedModel}, daemon using ${currentModel}. ` +
    `Run /rebuild-embeddings to fix.`
  );
}
```

**Edge case**: What if collection has no metadata (pre-migration)?
- Treat as unknown model
- Log warning, prompt rebuild
- Don't auto-rebuild (could be expensive)

**Already specified in**: DESIGN.md "Embedding Model Consistency" section

**Validation needed**: Test collection metadata persistence across Chroma versions

---

## 9. Similarity Threshold Tuning 🔍

**Question**: Default similarity threshold of 0.7 — is this model-dependent?

**Answer**: Yes, very model-dependent

**Implication**: Can't hardcode default, needs per-model calibration

**Decision**: 
- Ship with conservative default (0.7 for nomic-embed)
- Calibration mode measures actual similarity distribution
- `/context-calibrate` recommends threshold adjustment based on data

**Validation needed**: Collect similarity scores during POC, check distribution

**Already noted in**: DESIGN.md "Similarity threshold caveat" section

---

## 10. Zero-Hit Pattern Cleanup ✅

**Question**: Patterns never retrieved in 90 days — auto-delete or prompt?

**Decision**: Three-tier graduated nudges, never auto-delete

**Implementation**: `/context-calibrate --report` shows:

```
Zero-hit patterns (never retrieved in 90+ days):

⚠️  High confidence stale (9 patterns):
    • mobile-gestures.md (created 6 months ago, 0 hits)
    • deprecated-api-v1.md (contains "deprecated" in title)
    • old-selenium-config.md (contains "old" in title)
    
⚠️  Possibly stale (4 patterns):
    • ios-simulator-tips.md (created 3 months ago, 0 hits)
    • android-emulator.md (created 2 months ago, 0 hits)
    
✓  Probably fine (2 patterns):
    • emergency-runbook.md (created 2 weeks ago, niche but important)
    • disaster-recovery.md (contains "emergency" marker)

Archive high-confidence stale patterns? [y/N]
```

**Heuristics for classification**:
- **High confidence**: `(age > 90 days) AND (hits == 0) AND (title contains ["deprecated", "old", "legacy"])`
- **Possibly stale**: `(age > 60 days) AND (hits == 0)`
- **Probably fine**: `(age < 30 days) OR (title contains ["emergency", "runbook", "incident", "disaster"])`

**Rationale**:
- **User stays in control**: No auto-delete, no data loss risk
- **Context helps decision**: Age + naming hints at actual staleness
- **Progressive disclosure**: Worst offenders surfaced first
- **Conservative on edge cases**: Niche-but-important patterns protected

**Validation needed**: During POC, check if heuristics match intuition (would you actually archive what it flags as "high confidence"?)

---

## Questions to Revisit During POC

These can't be fully answered until we have working code:

1. **Pattern length distribution** — Do we need compression? (Question 5)
2. **Similarity score distribution** — Is 0.7 threshold right? (Question 9)
3. **Injection format effectiveness** — Does thinking reference context clearly? (Question 2)
4. **Ollama evaluation quality** — Is it viable with thinking blocks? (Already partially answered: probably not for 8B)
5. **Daemon memory usage** — Can it handle 10+ projects loaded? (Not yet questioned, but worth monitoring)

---

## V2 Architecture Questions

These extend the quality measurement infrastructure beyond POC scope:

### 11. Harmful Stale Pattern Detection (V2) ❓

**Question**: How do we detect patterns that are retrieved, used, but *wrong*?

**The gap**: Current design handles zero-hit stale and low-use stale, but not the hardest case:
```
retrieved → used → wrong
```

**Proposed approach**: Natural correction detection via Stop hook

**Detection logic**:
1. Stop hook sees conversation turn
2. Check user message for correction signals: "actually", "that's wrong", "outdated", "don't do that", "deprecated"
3. Cross-reference with patterns injected in previous turn
4. If correction references pattern topic → flag pattern + log correction incident

**Infrastructure**: Shares eval worker (new job type: `correction_detection`)

**Data captured**:
```json
{
  "type": "correction_detected",
  "pattern": "error-handling.md",
  "user_correction": "Actually, we stopped using that approach...",
  "flagged_for_review": true,
  "incident_count": 3
}
```

**Workflow**:
1. Pattern flagged after first correction
2. Downweight in retrieval (similarity × 0.5) until reviewed
3. Surface in `/context-calibrate --report` under "Flagged patterns needing review"
4. User can fix, archive, or clear flag

**Open questions**:
- What correction signals are reliable? (need to validate false positive rate)
- Should we downweight immediately or wait for 2-3 corrections?
- How long should downweighting last?

---

### 12. Usefulness Scoring Rubric (V2) 🚧

**Question**: What's the exact prompt and rubric for calibration evaluation?

**Current state**: Gestures at "Haiku judges usefulness" but no concrete prompt

**Proposed rubric**:

```
You are evaluating whether injected context patterns were useful.

Original prompt:
{user_prompt}

Injected patterns:
1. logger-helper.md (snippet: "Log retry attempts...")
2. test-data-setup.md (snippet: "Use fixtures...")
3. error-handling.md (snippet: "Wrap async calls...")

Claude's thinking:
{preceding_reasoning}

Claude's response:
{assistant_message}

For each pattern, rate its usefulness:
- critical (1.0): Response would be wrong/incomplete without it
- helpful (0.7): Improved answer quality or saved time
- mentioned (0.3): Referenced but not essential
- unused (0.0): Injected but not used

Look for:
- Explicit references in thinking ("the logger-helper pattern shows...")
- Implicit usage (advice matches pattern without naming it)
- Contradictions (response contradicts pattern → flag for review)

Output format (one per line):
1:helpful
2:unused
3:critical
```

**Validation metrics**:
- Inter-rater reliability (Haiku vs Sonnet on 20 samples)
- Explicit vs implicit usage detection accuracy
- Contradiction detection precision/recall

**Implementation**: Belongs in `daemon/eval-worker.js` evaluation prompt

---

### 13. Adaptive Injection Floor (V2) ❓

**Question**: Should the injection floor self-optimize over time?

**Current design**: Manual threshold (0.7), periodic recalibration, human adjustment

**Self-optimization dimensions**:

**A. Rolling window adaptation**
- Track last 100 calibration evals
- Calculate optimal floor (maximize weighted_score - injection_cost)
- Recommend adjustment if delta > 0.05

**B. Per-category floors**
```json
{
  "injectionFloor": 0.7,  // global default
  "perCategory": {
    "tests": 0.75,        // higher bar
    "architecture": 0.65   // lower bar (high-value, rare matches)
  }
}
```

**C. Per-model floors**
- Different embedding models → different similarity distributions
- nomic-embed-text-v1.5 calibrated at 0.7
- all-MiniLM-L6-v2 might need 0.65

**D. Per-project floors**
- Sensitive projects (payments, security) → higher bar
- Experimental projects → lower bar

**E. Decay curves**
- Pattern unused for 30 days → raise floor by 0.05
- Pattern consistently high-rated → lower floor by 0.05

**Data structures** (v1 schema, v2 logic):
```json
{
  "injectionFloor": 0.7,
  "adaptiveFloors": {
    "enabled": false,  // v2 feature flag
    "perCategory": {},
    "rollingWindow": {
      "samples": 100,
      "recommendedFloor": 0.72,
      "confidence": 0.85
    },
    "decayCurves": {
      "unused_penalty": 0.05,
      "high_rated_bonus": -0.05
    }
  }
}
```

**Algorithm** (v2):
After each calibration batch:
1. Calculate floor that would maximize (quality_score - injection_overhead)
2. If recommended floor differs by >0.05 → prompt user
3. Track adjustment history (prevent oscillation)

**Open questions**:
- Is optimization objective right? (maximize quality - cost)
- How to prevent overfitting to recent calibration samples?
- Should adaptation be automatic or always user-approved?

---

## Deferred to Post-MVP

These are good ideas but not blockers:

- Pattern compression (DESIGN.md: deferred to v2)
- Hybrid semantic + keyword search (DESIGN.md: future)
- Context versioning / rollback (DESIGN.md: future)
- Collaborative corpus sharing (DESIGN.md: Phase 3)
