---
name: injection-floor
description: Why the injection floor exists, how it's applied, and the 0.45 default calibration story
metadata:
  type: implementation
  tags: [retrieval, floor, calibration, quality]
---

# Injection Floor Implementation

The **injection floor** is the minimum similarity score required for a pattern to be injected. Below it, nothing injects — and that's a **first-class success**, not a failure.

## Why It Exists

Vector search always returns top-K results, even when they're garbage. There's no natural zero.

**Without a floor:**
- Query: "What's for lunch?"
- Top result: `dev/LOGGING.md` (similarity: 0.09)
- Result: Inject irrelevant pattern, pollute context

**With a floor (0.45):**
- Query: "What's for lunch?"
- Best score: 0.09 (below floor)
- Result: No injection (logged as success)

The floor restores the self-gating that keyword search gave for free.

## How It's Applied

**Gates on RAW similarity, not re-ranked score:**

```typescript
function applyFloor(ranked: RankedResult[], floor: number): FloorResult {
  const kept = ranked.filter(r => r.similarity >= floor);
  const dropped = ranked.filter(r => r.similarity < floor);
  
  return {
    kept,
    dropped,
    bestScore: ranked.length > 0 ? Math.max(...ranked.map(r => r.similarity)) : 0,
    noInject: kept.length === 0
  };
}
```

**Why raw similarity?** The floor answers "is this chunk relevant at all?" A type boost in reranking should never push a 0.2-similarity chunk over the line. Re-ranking decides ORDER among chunks that already cleared the floor.

## Default Value: 0.45

**History:**

1. **DESIGN.md placeholder:** 0.7
   - Too high — would suppress good matches with nomic-embed-text

2. **Phase-1 measurement:**
   - Correct top hits: 0.45–0.68
   - Noise floor: ~0.0–0.09
   - Gap exists, but nowhere near 0.7

3. **Current default:** 0.45 (permissive)
   - Lets valid patterns through
   - Still drops obvious noise
   - **UNVALIDATED** — needs Phase-5 calibration replay to tune

**Config location:**
```jsonc
{
  "retrieval": {
    "injectionFloor": 0.45
  }
}
```

## Separate from Reranking Threshold

**Two different knobs:**

- `retrieval.injectionFloor` (0.45) — Minimum to inject at all
- `retrieval.similarityThreshold` (0.7) — Boosts re-ranking score for high-similarity chunks

**Purpose:** Floor = relevance gate, threshold = reranking signal

## Near-Miss Detection

When `bestScore > 0.25` but `< floor`, contextus detects a **retrieval gap**:

```typescript
if (bestScore > 0.25 && bestScore < floor) {
  // Near-miss: knowledge might exist but phrasing missed it
  // Inject awareness notice to prompt capture or clarification
}
```

This powers the "retrieval gap detected" footer that prompts context capture when patterns almost-but-not-quite match.

## No-Inject is Success

When the floor drops everything:

**Logged:**
```json
{
  "event": "no-inject",
  "project": "/Users/...",
  "promptHash": "abc123",
  "bestScore": 0.12,
  "floor": 0.45,
  "reason": "all below floor"
}
```

**Returned to hook:**
```json
{
  "continue": true
}
```

No `hookSpecificOutput` — Claude proceeds without context injection.

## Calibration (Phase 5)

The floor should be tuned per corpus via **replay**:

1. Collect usage logs (which patterns were actually used after injection)
2. Replay logs with varying floor values (0.3, 0.35, 0.4, 0.45, 0.5...)
3. Measure: What floor maximizes (used patterns injected) / (total patterns injected)?
4. Deploy that floor

**Command:** `/context-calibrate --floor`

**Current state:** Floor replay works; post-prompt usage evaluation (Stop hook) not yet implemented.

## Dropped Chunks Are Logged

Everything below the floor is logged with its score:

```json
{
  "event": "retrieval",
  "floorDropped": [
    { "pattern": "reference/unused.md", "score": 0.38 },
    { "pattern": "dev/old-notes.md", "score": 0.22 }
  ]
}
```

This feeds calibration analysis and v2 governance (which patterns are chronically below-floor?).

## Tradeoffs

**Pros:**
- Prevents garbage injection (keeps context clean)
- No-inject is a first-class, logged outcome
- Per-project tunable (git-committed config override)

**Cons:**
- Too high → suppress valid patterns (false negatives)
- Too low → inject noise (false positives)
- Model-dependent (nomic-embed-text's 0.45 won't work for other embedders)
- Needs calibration per corpus (unvalidated default)

## Code Location

- `lib/retrieval/floor.ts` — Floor application logic
- `daemon/server.ts` — Integration in `/query` pipeline (line 346)
- `lib/retrieval/miss-notice.ts` — Near-miss detection (gap awareness)

## Related

- **Calibration** — Tunes the floor via replay (`/context-calibrate --floor`)
- **Near-miss detection** — Fires awareness when `bestScore` is close to floor
- **Reranking** — Happens BEFORE floor (floor gates on raw similarity)
