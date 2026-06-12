# Context Calibrate

Usage-driven optimization suggestions — analyzes your actual retrieval patterns and recommends config changes.

## When to Use

- After 1-2 weeks of using contextus (need usage data)
- When switching from `propose` to `auto` mode
- When retrieval feels too noisy or too sparse
- Quarterly optimization check

## What It Shows

Analyzes usage patterns (last 30 days) and suggests concrete config changes:

```
Calibration Analysis (based on 847 retrievals)

Usage Patterns:

Source Distribution:
  projectContext: 680 hits (80%) ✓ Primary source
  projectDocs: 142 hits (17%)
  userContext: 25 hits (3%) ⚠ Underutilized

Pattern Frequency:
  High-frequency (10+/week): 8 patterns
  Medium (3-9/week): 18 patterns  
  Low (1-2/week): 32 patterns
  Zero-hit: 14 patterns ⚠

Retrieval Quality:
  Avg patterns retrieved: 3.2 per query
  Avg patterns used (in footer): 1.4 per query ⚠ 56% waste
  Avg latency: 156ms ✓

Recommendations:

1. Reduce topK from 5 to 3
   Why: You only use 1.4 patterns on average, retrieving 5 is wasteful
   Impact: -35% tokens injected, -20ms latency

2. Disable userContext source
   Why: Only 3% of hits, adds query overhead for minimal value
   Impact: -15ms latency, simpler config

3. Review zero-hit patterns
   Why: 14 patterns never retrieved in 30 days
   Action: Run /context-doctor --calibrate for list

4. Switch to 'auto' capture mode
   Why: 47 [new] proposals in 30 days, you approved 43 (91%)
   Impact: Save time, fewer manual approvals

5. Consider per-category thresholds (v2)
   Why: 'testing' patterns have lower avg similarity (0.68) than 'framework' (0.82)
   Note: Requires custom config, not yet implemented

Apply changes: /configure
```

## Usage-Driven Insights

### Retrieval Efficiency

Compares `topK` setting vs. actual usage:
- If you retrieve 5 but only use 2 → reduce topK
- If similarity scores show sharp dropoff (0.85, 0.84, 0.62, 0.61, 0.58) → threshold is better than topK

### Source Utilization

Analyzes which sources are actually valuable:
- If userContext is <5% of hits → consider disabling
- If projectDocs is >50% → increase its weight in re-ranking

### Pattern Health

- Zero-hit patterns → candidates for deletion
- High-frequency patterns → ensure they're well-maintained
- Patterns with high retrieval but low use → too generic, consider splitting

### Capture Mode Readiness

Tracks proposal accuracy:
- If 90%+ of [new] proposals get approved → ready for `auto`
- If <70% approval rate → stay in `propose`, tune dedup threshold

### Threshold Tuning

Analyzes similarity score distribution:
- If 80% of retrievals are >0.85 → threshold is too low, increase to 0.75
- If <40% of retrievals → threshold too high, lower to 0.65

## Flags

```bash
/context-calibrate              # Full analysis with recommendations
/context-calibrate --apply      # Show config diff for recommended changes
/context-calibrate --source userContext  # Focus on specific source
```

## Implementation

Requires:
1. **Usage log analysis**: Parse `usage.jsonl` for last 30 days
2. **Pattern metadata**: Query ChromaDB hit_count, compare to retrieval log
3. **Config comparison**: Current config vs. optimal based on patterns
4. **Footer parsing** (optional): Extract "Context: used:" to measure waste

## Design Notes

This is **proactive optimization** based on real usage data. Unlike `/context-doctor` (reactive troubleshooting), calibrate suggests improvements even when things are working.

Key insight: Most users won't manually tune config. Calibrate does the analysis and says "based on how you actually use it, here's what to change."

Complements:
- `/context-status`: Shows impact ("tokens saved")
- `/context-calibrate`: Shows optimization potential ("could save 35% more")
- `/context-doctor`: Fixes problems ("why broken?")
