---
type: gotcha
tags: [lancedb, embedding, scoring, similarity]
created: 2026-06-18
---

# LanceDB L2² Distance ≠ Cosine Distance

## The Bug

LanceDB with cosine metric returns `_distance` as **L2 squared** (Euclidean distance squared between L2-normalized vectors), NOT `1 - cosine_similarity`.

For unit-normalized vectors (which nomic-embed-text produces):

```
cosine_similarity = 1 - L2²/2
```

The old formula `1 - _distance` gave HALF the correct similarity values — a `_distance` of 0.858 was reported as similarity 0.142 when the true cosine similarity is 0.571.

## Why It Matters

- All thresholds (injectionFloor, expansionThreshold, noise floor) are defined on the **similarity** scale
- Wrong formula → scores compressed into [0, 0.5] instead of [0, 1]
- Made the floor too easy to clear (0.45 on compressed scale ≈ 0.1 true cosine)
- Masked by the RRF normalization bug (which forced top score to 1.0 anyway)

## Correct Thresholds (post-fix)

| Threshold | Old (wrong scale) | New (correct cosine) |
|-----------|-------------------|---------------------|
| injectionFloor | 0.45 | 0.725 |
| expansionThreshold | 0.55 | 0.775 |
| near-miss noise floor | 0.25 | 0.625 |

## The Fix

`lib/storage/lance-client.ts`:
```typescript
similarity: 1 - r._distance / 2  // correct: cosine from L2²
```

## Calibration Impact

The floor-calibration replay (`/context-calibrate --floor`) calls `search()` which returns the corrected similarity values — so calibration recommendations are automatically on the correct scale. The `FLOOR_GRID` was extended to cover the 0.3–0.85 range (previously 0.05–0.7, which capped below the new operating range).

## Verification

Manually compute: if two unit vectors have cosine_similarity=0.8, then L2² = 2*(1-0.8) = 0.4, and `1 - 0.4/2 = 0.8`. Checks out.
