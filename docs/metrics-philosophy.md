---
name: metrics-philosophy
description: Strategic direction for metrics — from activity tracking to utility measurement
metadata:
  type: reference
  tags: [metrics, calibration, v2, strategy]
---

# Metrics Philosophy: From Activity to Utility

_Source: External feedback, 2026-06-16_
_Relevance: v2 roadmap — strategic direction for metrics evolution_

---

## The Phase Shift

Early-stage projects ask: **"Can this work?"**
Metrics-stage projects ask: **"Can I prove it's working?"**

Contextus v1 has the hard foundation:
- Automatic retrieval
- Context injection
- Pattern storage
- Calibration loop (stop-eval hook + Haiku judge)
- Awareness hooks
- Context indexes
- Search/debug commands

The focus on metrics signals a transition from **proving feasibility** to **proving value**.

---

## The Deceptive Success Problem

Context systems are deceptive. A user might feel like Contextus is helping because:
1. Retrieval happened
2. Context was injected
3. Claude referenced it

**But that doesn't necessarily mean the retrieval was valuable.**

Injection ≠ utility.

---

## Why Metrics Matter

Without metrics, you're operating on intuition. With metrics, you can answer:

| Metric | Why it matters |
|--------|----------------|
| **Injection rate** | Are we retrieving too aggressively? |
| **Acceptance rate** | How often does injected context actually get used? |
| **Hit frequency** | Which patterns are valuable? |
| **False-positive rate** | Which patterns should stop being injected? |
| **Context cost** | How many tokens are being spent? |
| **Calibration drift** | Is the system learning or thrashing? |

---

## The Metric to Obsess Over

Not retrieval count.
Not search count.
Not even hit count.

**Context Utility Score (CUS):**

```
Pattern injected
    ↓
Referenced by Claude (awareness footer: "used: X")
    ↓
Influenced output (stop-eval: Haiku judges thinking blocks)
    ↓
User continued without correction
    ↓
Score++
```

Steps 1-3 are already partially instrumented via the stop-eval hook and awareness footer. Step 4 (user correction rate) is the new v2 signal.

### Why CUS Matters

**Pattern A:**
- 50 injections, 45 useful
- **CUS: 90%** → boost, promote, keep fresh

**Pattern B:**
- 50 injections, 2 useful
- **CUS: 4%** → archive, merge, compress, or delete

### Temporal Decay

CUS scores are temporal — a pattern with 90% utility 3 months ago might be stale now. Time-weighted CUS (freshness penalty for patterns not retrieved recently) prevents dead patterns from coasting on historical scores.

---

## The Ultimate Dashboard

Not this:
```
Patterns: 127 | Injections: 542 | Hits: 413
```

This:
```
Top Context Assets

1. Project Architecture     Utility: 97%
2. Coding Standards         Utility: 92%
3. Testing Workflow         Utility: 88%
4. Docker Notes             Utility: 14%  ← Why am I carrying this?
```

At that point, Contextus starts becoming **self-optimizing** — the usage-ratchet concept where patterns earn their place through demonstrated utility, not just existence.

The system can ask:
- Why am I carrying around this low-value context?
- Can I merge these redundant patterns?
- Should I archive stale patterns?
- Which patterns get priority in tight token budgets?

---

## The "Less Is More" Paradox

Most projects accidentally optimize for **more retrieval** when they should optimize for **less retrieval, higher relevance**.

**The best context system injects less context over time because it gets smarter about what matters.**

Mature systems should be **leaner**, not fatter.

---

## The Real Challenge: Observability

The future challenge isn't retrieval. It's **observability**.

Six months from now you need to answer:

> **"Did Contextus make Claude better, or did it just make Claude more informed?"**

| Outcome | What it means |
|---------|---------------|
| **More informed** | More tokens consumed, more context available |
| **Better** | Higher quality decisions, fewer corrections, less user intervention |

The first is easy. The second is the real goal.

---

## What v1 Measures vs What v2 Should Measure

### v1 (Activity-focused)
- Injection rate
- Retrieval latency
- Token compression ratio
- Similarity scores
- Per-pattern hit counts + `last_hit` timestamps

### v2 (Utility-focused)
- **Acceptance rate** — How often was injected context actually used?
- **Per-pattern utility (CUS)** — Which patterns are high-value vs noise?
- **False-positive rate** — Injected but not referenced?
- **Influence score** — Did it shape the output or just get loaded?
- **Self-optimization signals** — Which patterns should be archived/merged?
- **User correction rate** — How often does the user have to fix Claude's output?

---

## Implementation Path

The calibration work (`/context-calibrate`) and stop-eval hook are the foundation. What already exists:

- Awareness footer parsing ("Context: used: X, Y")
- Haiku-as-judge evaluation of thinking blocks
- Per-pattern hit tracking and `last_hit` timestamps in LanceDB

**What v2 adds:**

1. **Aggregate CUS scoring** — roll up stop-eval judgments into a running utility score per corpus row.

2. **Correction tracking** — measure how much the user corrects Claude's response (low correction = high utility). Requires correlating injected patterns with subsequent user edits.

3. **Temporal decay** — weight recent utility higher than historical. A pattern unused for N days loses score regardless of past performance.

4. **Threshold automation** — patterns below a CUS threshold get flagged for review, then archived if they don't recover. This is the "removal governance" item on the v2 roadmap.

5. **Correlation analysis** — patterns that appear in high-acceptance conversations vs low-acceptance conversations surface structural insights about what makes context valuable.

---

## Key Takeaway

The shift from "retrieval metrics" to "utility metrics" is the difference between:
- A context system that works → a context system that **proves it works**
- A context system that needs manual curation → a context system that **optimizes itself**

---

_Next steps: Prototype CUS tracking in v2. Start with aggregating stop-eval judgments per pattern as a lightweight proxy for utility._
