# Contextus: Context Applicability Evaluator (CAE) — Full System Spec

This document combines:

- system architecture
- CAE runtime prompt
- scoring rubric
- tag ontology seed set
- execution flow
- design invariants
- context removal & governance (soft/hard/replacement removal)

It is intended to be directly implementable.

---

# 1. System Overview

The Context Applicability Evaluator (CAE) is a semantic gating layer that determines whether retrieved context is allowed into the model's working context. It sits between retrieval and injection.

Its purpose is **NOT** search, ranking, or summarization.

Its purpose **IS**:

> applicability validation under semantic constraints

---

# 2. Core Architecture

```
User Query
   ↓
1. Category Router (coarse narrowing)
   ↓
2. Semantic Retrieval (broad candidate set)
   ↓
3. CAE Sub-Agent (applicability evaluation)
   ↓
4. Scoring + Filtering Layer
   ↓
5. Injection Policy (final context selection)
   ↓
6. Main Model Consumption
```

> Categories and tags consumed here are defined in [CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md). The injection floor referenced by the scoring layer is specified in [DESIGN.md](DESIGN.md).

---

# 3. CAE Runtime Prompt (Sub-Agent)

```
You are the Context Applicability Evaluator (CAE).

You do NOT search, retrieve, summarize, or rank.

You ONLY evaluate whether a candidate context is applicable for inclusion in
the model's working context for a given query.

## INPUTS
You will receive:
- USER QUERY
- QUERY INTENT (optional)
- CANDIDATE CONTEXT
- CATEGORY
- TAGS
- RETRIEVAL METADATA (optional)

## TASK
Decide whether the candidate context is:
1. Semantically relevant to the query
2. Applicable under current constraints
3. Safe and appropriate for injection

You are evaluating applicability, not usefulness in general.

## CRITICAL RULES
- Do NOT summarize or rewrite context
- Do NOT rank against other candidates
- Do NOT assume inclusion due to similarity
- Do NOT be influenced by verbosity or confidence

## EVALUATION AXES

### 1. Semantic Alignment
Does meaning align with query intent?
- direct match → strong signal
- conceptual overlap → weak signal
- unrelated domain → reject

### 2. Tag Applicability
Do tags indicate correct usage context?
- race-condition → concurrency relevance
- flaky → intermittent failure relevance
- deprecated → usually exclude

### 3. Context Compatibility
Is this safe/appropriate to inject?
- production vs debugging mismatch
- deprecated knowledge
- experimental instability
- risk of incorrect assumptions

## DECISION RULES
- Prefer false negatives over false positives
- If uncertain → lower confidence
- Only high confidence if all axes align
- Tags may override weak semantic signals

## OUTPUT FORMAT (STRICT JSON)
{
  "relevant": true,
  "confidence": 0.0,
  "applicability_score": 0.0,
  "reasons": [],
  "tag_alignment": {
    "matched": [],
    "conflicts": []
  }
}
```

---

# 4. Scoring Rubric (Daemon Layer)

## 4.1 Final Score Formula

```
final_score =
    (0.45 × applicability_score)
  + (0.35 × confidence)
  + (0.20 × semantic_overlap_prior)
```

## 4.2 Thresholds

```
INCLUDE:       final_score ≥ 0.70
SOFT INCLUDE:  0.50 – 0.69
EXCLUDE:       < 0.50
```

## 4.3 Hard Overrides

**Always EXCLUDE:**

- tag: `deprecated` (unless explicitly requested)
- tag: `internal-only` (outside internal scope)
- confidence < 0.25

**Always INCLUDE:**

- tag: `canonical` AND confidence > 0.8
- retrieval metadata: `manually-promoted`

## 4.4 Conflict Priority

1. Hard exclusion rules
2. CAE output
3. Tag alignment
4. Semantic similarity

---

# 5. Tag Ontology Seed Set

Tags are semantic constraint modifiers, not labels. (See [CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md) §8 for tag usage rules.)

**Behavioral**

```
race-condition  flaky  stateful  stateless  idempotent  non-idempotent
async  sync  non-deterministic  deterministic  side-effecting  pure-function
```

**Reliability**

```
canonical  experimental  deprecated  unstable
battle-tested  proven  low-confidence  high-confidence
```

**Risk**

```
high-risk-change  production-impact  debug-only  dev-only
safe-to-ignore  breaking-change
```

**Architecture**

```
architecture-critical  integration  api-contract
data-model  runtime-behavior  infrastructure
```

**Debug**

```
debugging-context  intermittent-failure  observability
logging-related  performance-issue  memory-leak
```

---

# 6. Execution Flow

```
1. Retrieve candidates (semantic + category)
2. For each candidate → send to CAE sub-agent
3. Collect CAE outputs
4. Apply scoring rubric
5. Filter by thresholds
6. Inject top-K into model context
```

---

# 7. Context Removal & Governance

Contextus supports adding, scoring, demoting, and annotating context. It must also support **removing** context — a governance primitive distinct from runtime demotion.

Add the *concept* of removal to the design now; implement the *mechanism* later. This keeps the Claude-first implementation clean while keeping the architecture future-proof.

## 7.1 Why removal becomes necessary

- **Staleness** — the file is no longer true.
- **Supersession** — a newer file replaces it.
- **Contradiction** — it conflicts with canonical knowledge.
- **Irrelevance** — CAE rejects it so often it becomes noise.

Demotion handles runtime irrelevance, but long-term system health requires explicit removal.

## 7.2 Three forms of removal

1. **Soft Removal (runtime suppression)**
   - CAE marks `applicability=false`, low confidence, or conflicting tags.
   - File remains in the corpus but is ignored during injection.

2. **Hard Removal (governance action)**
   - Triggered by repeated CAE rejection, supersession, or contradiction.
   - Performed by the daemon or human approval.
   - File is deleted or archived.

3. **Replacement Removal (supersession)**
   - A new file replaces an old one.
   - The old file is archived or removed.
   - The new file becomes canonical.

## 7.3 What the architecture should track now

- The ontology acknowledges that files can be removed or superseded.
- The daemon tracks signals that *could* lead to removal (e.g., repeated CAE rejection frequency).
- CAE outputs metadata that informs potential removal decisions.
- The scoring pipeline accumulates evidence for removal.
- The governance layer (daemon + human) is responsible for actual deletion or archiving.

## 7.4 Invariant

> **Contextus supports soft removal at runtime and hard removal during governance. Runtime removal is demotion; governance removal is deletion or supersession.**

---

# 8. Failure Modes Prevented

- context dilution (too much irrelevant context)
- authority collapse (everything treated equally)
- tag explosion (tags becoming meaningless metadata)
- semantic noise injection
- corpus rot (stale/contradictory/superseded files accumulating — addressed by §7)

---

# 9. Design Invariants

- Retrieval ≠ Injection
- CAE is mandatory for all candidates
- CAE is not a ranking system
- CAE is a semantic applicability filter
- The model only sees validated context

---

# 10. System Principle

> Knowledge is only useful when it is applicable to the current reasoning state.

---

# 11. Minimal Implementation Version

1. Retrieve top N candidates
2. Run CAE per candidate
3. Keep: `relevant == true` and `confidence ≥ threshold`
4. Rank remaining
5. Inject top K

---

# 12. Extensions (Optional Future Layers)

- batched CAE evaluation (reduce cost)
- hierarchical tag compression
- adaptive thresholds per category
- CAE caching layer for repeated queries
- confidence calibration model
- automated hard-removal proposals from accumulated rejection evidence (§7)
