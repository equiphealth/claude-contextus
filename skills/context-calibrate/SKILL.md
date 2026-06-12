# Context Calibrate

Usage-driven optimization through quality evaluation — runs a calibration sample to measure real retrieval quality, then recommends config changes.

## When to Use

- **First time**: After 1-2 weeks of use (start calibration mode)
- When retrieval feels too noisy or too sparse
- Every 3-6 months to detect corpus drift
- When switching embedding models

## Two Modes

### 1. Start Calibration (interactive evaluation)

Enables quality evaluation for the next 100 prompts (configurable). Claude will rate each retrieved pattern as `critical`, `helpful`, `mentioned`, or `unused`. Shows live progress and preliminary insights.

### 2. Review Calibration (post-analysis)

After calibration completes, analyzes the collected quality data and recommends concrete config changes.

## Calibration Mode Output

### Starting Calibration

```bash
/context-calibrate --start
```

```
Contextus Calibration Started

Target: 100 evaluated retrievals
Mode: Quality evaluation enabled
Duration: ~1-2 weeks at typical usage

What's happening:
  • After each response, Claude rates injected patterns:
    - critical: Essential to the response
    - helpful: Improved the answer
    - mentioned: Referenced but not central
    - unused: Injected but not relevant
  
  • Results logged to ~/.contextus/logs/usage.jsonl
  • Auto-disables after 100 samples
  • Zero impact on your workflow (happens in background)

Check progress: /context-calibrate --status
```

### During Calibration (status check)

```bash
/context-calibrate --status
```

```
Contextus Calibration Progress

Status: 67/100 samples collected
Started: 8 days ago
Estimated completion: 5 days (at current usage rate)

Early Results (preliminary, n=67):

Quality Metrics:
  🎯 Weighted hit rate: 71% 
     ├─ Critical: 48 patterns (23%)
     ├─ Helpful: 62 patterns (30%)  
     ├─ Mentioned: 37 patterns (18%)
     └─ Unused: 60 patterns (29%)
  📊 Injection rate: 81% of prompts received context

Top Performers (weighted >85%):
  ✓ logger-helper.md: 92% (11 critical, 1 helpful, 1 unused)
  ✓ test-data-setup.md: 87% (7 critical, 2 helpful, 1 mentioned)
  ✓ wdio-retry-config.md: 85% (5 critical, 3 helpful, 0 unused)

Low Performers (weighted <20%, retrieved 5+ times):
  ⚠ generic-best-practices.md: 15% (retrieved 11×, 0 critical, 2 mentioned, 9 unused)
  ⚠ old-api-reference.md: 8% (retrieved 8×, 0 critical, 1 mentioned, 7 unused)

Preliminary Insights:
  • 29% unused rate suggests injection floor may be too low
  • 2 patterns with <20% weighted score are strong prune candidates
  • 3 patterns with >90% score should get re-ranking boost

Full analysis available after 100 samples: /context-calibrate --report
```

### After Calibration (final report)

```bash
/context-calibrate --report
```

```
Contextus Calibration Report (100 samples, 14 days)

Quality Summary:
  🎯 Weighted hit rate: 73% 
     ├─ Critical: 71 patterns (24%)
     ├─ Helpful: 89 patterns (30%)  
     ├─ Mentioned: 56 patterns (19%)
     └─ Unused: 79 patterns (27%)
  
  📊 Injection rate: 79% of prompts received context
  ⚡ Avg retrieval: 156ms
  📈 Trend: Quality improved from 71% (early) to 75% (final)

Pattern Analysis:

Top Performers (weighted >80%, n=12):
  ✓ logger-helper.md: 92% (13 critical, 2 helpful, 1 unused)
  ✓ test-data-setup.md: 88% (9 critical, 3 helpful, 1 mentioned)
  ✓ wdio-retry-config.md: 86% (7 critical, 4 helpful, 1 unused)
  ... (9 more)

Prune Candidates (weighted <20%, retrieved 5+ times, n=3):
  ⚠ generic-best-practices.md: 14% (retrieved 14×, 0 critical, 2 mentioned, 12 unused)
  ⚠ old-api-reference.md: 9% (retrieved 11×, 0 critical, 1 mentioned, 10 unused)
  ⚠ deprecated-wdio-v7.md: 18% (retrieved 6×, 1 helpful, 1 mentioned, 4 unused)

Zero-Hit Patterns (never retrieved, n=9):
  • mobile-gestures.md
  • ios-simulator-tips.md
  ... (7 more)

Recommendations:

1. 🎯 Raise injection floor from 0.65 → 0.72
   Why: 27% unused rate indicates noise getting through
   Impact: Estimated 22% reduction in unused injections
   Validation: Replay calibration samples with new floor (0 false negatives)

2. 🗑️ Remove 3 low-performers
   Files: generic-best-practices.md, old-api-reference.md, deprecated-wdio-v7.md
   Why: <20% weighted score across 10+ retrievals each
   Impact: -45 tokens/injection (avg), cleaner corpus

3. 📈 Boost 12 high-performers in re-ranking
   Apply +0.05 similarity bonus to patterns with >80% weighted score
   Impact: Critical patterns surface more reliably

4. 🔍 Review 9 zero-hit patterns
   Never retrieved in 100 samples — likely too specific or stale
   Action: Archive or delete (estimated -65 tokens/rebuild)

5. 📊 Reduce topK from 5 to 4
   Why: Avg 3.1 patterns used per retrieval (5 is overkill)
   Impact: -18% tokens injected, -15ms latency

Apply changes automatically: /context-calibrate --apply
Review config diff: /context-calibrate --diff
Manual review: /configure

Next calibration recommended: 2026-12-12 (6 months)
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
/context-calibrate              # Show current status (or start if not running)
/context-calibrate --start      # Begin quality evaluation (100 samples)
/context-calibrate --status     # Progress and preliminary insights
/context-calibrate --report     # Final analysis after completion
/context-calibrate --apply      # Auto-apply recommended config changes
/context-calibrate --diff       # Show config diff without applying
/context-calibrate --stop       # Cancel calibration early
```

## Implementation

### Phase 1: Enable Evaluation

1. Set `calibration.evaluateUsage: true` in config
2. Set `calibration.targetSamples: 100` (configurable)
3. Set `calibration.startedAt: <timestamp>`

### Phase 2: PostToolUse Hook (per prompt)

After Claude responds, if `evaluateUsage` is true:

1. **Call Haiku** (not Sonnet) with evaluation prompt — it has full context (original prompt, injected patterns, Claude's response):
   ```
   Original prompt: <user's question>
   
   Context patterns injected:
   1. logger-helper.md: <content snippet>
   2. test-data-setup.md: <content snippet>
   3. wdio-session-handling.md: <content snippet>
   4. browserstack-caps.md: <content snippet>
   5. appium-timeout-config.md: <content snippet>
   
   Claude's response: <full response>
   
   Which patterns were used and how helpful? Reply: number:rating
   
   Ratings:
   - critical: Essential to the response, answer would be wrong/incomplete without it
   - helpful: Improved the answer, provided useful detail
   - mentioned: Referenced but not central
   - unused: Injected but not relevant
   
   Reply format: "1:critical, 3:helpful, 4:mentioned, 2:unused, 5:unused"
   ```

2. Parse Haiku's response (e.g., `"1:critical, 2:helpful, 3:unused, 4:unused, 5:mentioned"`)
3. Map numbers → pattern slugs
4. Calculate weighted score: `(critical×1.0 + helpful×0.7 + mentioned×0.3) / total`
5. Log `calibration_eval` event to `usage.jsonl`
6. Increment sample counter

**Why Haiku for evaluation:**
- 10× cheaper than Sonnet ($0.0015 vs $0.015 per eval)
- Has full context (prompt + patterns + response) so can judge accurately
- Structured task (pattern matching + classification) is well within Haiku's capability
- Over 100 samples: $0.15 vs $1.50 — meaningful savings for background task
- **Proven reliable**: Haiku consistently follows format and distinguishes rating categories

**Ollama quality caveat**: Smaller open-source models (Llama 3.1 8B, 3.2, Mistral 7B) have shown poor reliability for this task in practice — inconsistent ratings, format compliance issues, difficulty with nuanced categories. Larger quantized models (70B-q4) may perform better but are unproven. If using Ollama for privacy, validate quality against Haiku baseline (run first 20 evals with both, compare ratings).

### Phase 3: Auto-Disable

After `targetSamples` reached:
1. Set `calibration.evaluateUsage: false`
2. Set `calibration.completedAt: <timestamp>`
3. Log completion event
4. Notify user: "Calibration complete. Run /context-calibrate --report"

### Phase 4: Analysis

Parse all `calibration_eval` events:
1. Aggregate weighted scores per pattern
2. Identify top performers (>80%), low performers (<20%), zero-hit patterns
3. Simulate threshold changes (replay scores, measure false negatives)
4. Calculate optimal `topK` (percentile analysis on used patterns)
5. Generate recommendations with impact estimates

## Design Notes

This is **honest quality measurement** via explicit evaluation, not inference from token metrics.

**Why evaluation mode instead of always-on footer parsing?**
- More explicit and reliable than parsing `Context: used:` footers
- Structured ratings (critical/helpful/mentioned/unused) give richer signal than binary
- Only runs during calibration (no ongoing overhead)
- 100 samples provides statistical significance without being burdensome
- Weighted scores enable re-ranking and pruning decisions

**Key insight**: "Tokens saved" measures compression efficiency. Calibration measures retrieval quality. The first is easy to compute but answers the wrong question. The second requires human judgment but tells you whether the system actually works.

**Complements:**
- `/context-status`: Shows current health and usage trends
- `/context-calibrate`: Measures quality and suggests optimization
- `/context-doctor`: Reactive troubleshooting (fixes breakage)

**Calibration cadence:**
- First time: After 1-2 weeks of use
- Ongoing: Every 3-6 months (detects corpus drift)
- After major changes: Embedding model switch, corpus rewrite, threshold adjustment
