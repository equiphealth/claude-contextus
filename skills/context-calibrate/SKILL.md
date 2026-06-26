---
name: context-calibrate
description: Quality measurement and optimization — evaluate whether injected context is actually USED (not just retrieved), tune injectionFloor, report calibration results. The usage-eval campaign that proves whether contextus is working.
---

# Context Calibrate

The single front door for **both** floor-calibration signals
(calibration-two-signals), with one shared apply path:

1. **Cold-start floor-replay** (`--floor`) — replays your real historical prompts
   through the retrieval path and recommends an injection floor from the
   similarity distribution. **Works with zero usage history** (it only needs a
   corpus + your transcripts). Same engine as the `calibrate-floor.ts` dev CLI (run
   via `tsx` by path — see "HOW TO ACTUALLY RUN THIS" below; never `pnpm`).
2. **Usage-eval refinement** (`--start`/`--status`/`--report`/`--stop`) — runs a
   Haiku grading campaign over real injections, then recommends knobs from whether
   patterns were actually **used**. Needs accumulated usage.

The clean lifecycle: **floor-replay sets the cold-start floor → usage-eval refines
it once real usage accumulates.** Both write through the same `--diff`/`--apply`
plumbing into `plugin.json` `config.retrieval.*`.

## Floor calibration (cold-start, the first thing to run)

> **HOW TO ACTUALLY RUN THIS (read first — the `/context-calibrate` lines below are
> the user-facing names, NOT a command that self-executes).** This skill has no
> runner of its own; you (Claude) must execute the engine script via a Bash tool
> call. **Do NOT use `pnpm`** — the contextus repo needs Node 22 and the user's
> shell may be on a different Node, so `pnpm` errors out (observed). Invoke the
> repo-local `tsx` **by path**, from the TARGET PROJECT's directory so it calibrates
> the right corpus:
> ```bash
> cd <target-project>   # the project you're calibrating (cwd = its corpus)
> ~/src/claude-contextus/node_modules/.bin/tsx \
>   ~/src/claude-contextus/scripts/calibrate-floor.ts --project <project-name> [--limit N] [--json]
> ```
> **CRITICAL: `--project` expects the PROJECT NAME (substring match), NOT the projectId hash.**
> - ✅ RIGHT: `--project claude-contextus` (matches transcript dir slug)
> - ❌ WRONG: `--project 8fa4d8ac62c3` (hash won't match transcript directory)
>
> The script looks for transcripts under `~/.claude/projects/-Users-...-{project-name}/`.
> Pass the last segment of that directory name. If you pass the hash, you'll get:
> "No Claude Code transcripts found for [hash]".
>
> This prints the distribution + trade curve + recommendation (never applies). To
> apply, edit `config.retrieval.injectionFloor` in the contextus repo's
> `plugin.json` (or run the engine's apply path if present). If the corpus doesn't
> exist yet, embed first (see MIGRATION_GUIDE — same `tsx`-by-path rule, NOT
> `pnpm --prefix`).

The user-facing modes (names, not self-executing commands):

```bash
/context-calibrate --floor              # replay real prompts → recommend a floor (print only)
/context-calibrate --floor --diff       # show the plugin.json diff it would make
/context-calibrate --floor --apply      # write config.retrieval.injectionFloor
```

`--floor` prints the top-1 similarity distribution + a **floor → injection-rate
trade curve** + a gap-based recommendation. **Eyeball the trade curve and pick the
injection rate you want before `--apply`** — the recommendation is a starting
point, not a verdict (the exit criterion is "is this floor sane?", which only you
can answer against your own corpus). Nothing is written without `--apply`.

> The recommended floor is **corpus-bound**: a small/young corpus pushes it around
> (most replayed prompts have no real match yet). Re-run after the corpus grows
> (e.g. post-`/migrate-memory`).

## When to Use

- **First time, immediately**: `--floor` to set a sane cold-start floor.
- **After 1-2 weeks of use**: `--start` a usage-eval campaign to refine.
- When retrieval feels too noisy or too sparse.
- Every 3-6 months to detect corpus drift.
- After switching embedding models or a big corpus change → re-run `--floor`.

## Two Modes (usage-eval)

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
# Floor calibration (cold-start signal)
/context-calibrate --floor          # Replay real prompts → recommend an injection floor
/context-calibrate --floor --diff   # Show the plugin.json diff it would make
/context-calibrate --floor --apply  # Write config.retrieval.injectionFloor

# Usage-eval campaign (refinement signal)
/context-calibrate                  # Show current campaign status
/context-calibrate --start          # Begin quality evaluation (targetSamples)
/context-calibrate --start --samples 50   # …with a custom target
/context-calibrate --status         # Campaign progress
/context-calibrate --report         # Aggregate per-pattern quality from logged evals
/context-calibrate --stop           # Cancel the campaign early
```

Engine / dev entry point (prints, never applies). Run via the repo-local `tsx` by
path — NOT `pnpm` (Node-version mismatch errors out):

```bash
cd <target-project>
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/calibrate-floor.ts [--limit N] [--json]
# (--project X also works, but cd-into-the-project is the reliable form —
#  the script resolves the corpus from cwd, like embed/query.)
```

## Implementation

### Phase 1: Enable Evaluation

1. Set `calibration.evaluateUsage: true` in config
2. Set `calibration.targetSamples: 100` (configurable)
3. Set `calibration.startedAt: <timestamp>`

### Phase 2: Stop Hook (per prompt)

After Claude's complete response, if `evaluateUsage` is true, the Stop hook fires with full context:

**Stop Hook Payload**:
```json
{
  "event_type": "Stop",
  "user_message": "How do I handle flaky Appium tests?",
  "assistant_message": "You can add retry logic with wdio-retry...",
  "preceding_reasoning": "<thinking>Looking at logger-helper.md context... I'll incorporate that logging guidance...</thinking>",
  "stop_reason": "end_turn"
}
```

**Implementation**:

1. **UserPromptSubmit hook** stores injected patterns in session state:
   ```json
   {
     "injected_patterns": [
       {"id": "logger-helper", "snippet": "Log retry attempts for debugging..."},
       {"id": "test-data-setup", "snippet": "Use fixtures to isolate test state..."}
     ]
   }
   ```

2. **Stop hook** retrieves session state and calls evaluation model (Haiku/Ollama):
   ```
   User prompt: {user_message}
   
   Context patterns injected:
   1. logger-helper.md: {snippet}
   2. test-data-setup.md: {snippet}
   3. wdio-session-handling.md: {snippet}
   4. browserstack-caps.md: {snippet}
   5. appium-timeout-config.md: {snippet}
   
   Claude's thinking: {preceding_reasoning}
   
   Claude's response: {assistant_message}
   
   Which patterns did Claude use? Reply: number:rating
   
   Ratings:
   - critical: Essential to the response, answer would be wrong/incomplete without it
   - helpful: Improved the answer, provided useful detail
   - mentioned: Referenced but not central
   - unused: Injected but not relevant
   
   Reply format: "1:critical, 3:helpful, 4:mentioned, 2:unused, 5:unused"
   ```

3. Parse evaluation response (e.g., `"1:critical, 2:helpful, 3:unused, 4:unused, 5:mentioned"`)
4. Map numbers → pattern slugs
5. Calculate weighted score: `(critical×1.0 + helpful×0.7 + mentioned×0.3) / total`
6. Log `calibration_eval` event to `usage.jsonl`
7. Increment sample counter

**Why thinking blocks matter**: `preceding_reasoning` shows Claude's internal deliberation about the injected context. If Claude explicitly reasons "I'll use pattern X" or "pattern Y isn't relevant here," the evaluation becomes trivial — just check if Claude mentioned using it. This makes even Ollama models viable since the task becomes "did Claude say they used this?" not "infer whether this was semantically relevant."

**Why Haiku for evaluation:**
- 10× cheaper than Sonnet ($0.0015 vs $0.015 per eval)
- Has full context (prompt + patterns + thinking + response) so can judge accurately
- Structured task (pattern matching + classification) is well within Haiku's capability
- Over 100 samples: $0.15 vs $1.50 — meaningful savings for background task
- **Proven reliable**: Haiku consistently follows format and distinguishes rating categories

**Ollama quality caveat**: Smaller open-source models (Llama 3.1 8B, 3.2, Mistral 7B) showed poor reliability in semantic search quality evaluation (the vector-inspector use case). However, **the contextus evaluation task is easier** — we're asking "did Claude use this?" with thinking blocks as evidence, not "is this semantically relevant?" without ground truth. With thinking blocks included, even small models may be viable. Validate quality against Haiku baseline (run first 20 evals with both, compare ratings) before trusting.

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
