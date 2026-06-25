---
name: calibration-bootstrap-catch22
description: Calibration campaign can't collect samples when injection floor prevents all injections - bootstrap problem
metadata:
  type: gotcha
  tags: [calibration, phase1, injection-floor]
---

# Problem

The Phase 1 usage evaluation campaign collects samples by evaluating injected context. But if the injection floor is strict enough that **no context gets injected**, the campaign can't collect any samples.

**Example scenario:**
- Injection floor: 0.725 (strict)
- Prompt similarity scores: 0.64, 0.68, 0.71 (all below floor)
- Result: No injections → No evaluations → 0/20 samples collected
- Status: "Phase 1 collection in progress" but stuck at 0/20

# Why It Happens

The evaluation only triggers when context **was actually injected** (by design - can't evaluate what wasn't used). The Stop hook enqueues evaluation jobs for injections, not for skipped queries.

But if the floor is too strict for the current corpus/prompts, nothing gets injected, so nothing gets evaluated.

# Solution Options

1. **Temporarily lower the floor during bootstrap** (0.35-0.5) to collect initial samples, then tune it back up based on usage data
2. **Manually inject known-good patterns** to seed the campaign (requires code change to force-inject)
3. **Wait for naturally high-similarity prompts** that exceed the floor (could take a long time)
4. **Use a separate calibration corpus** with more generic/diverse patterns that match more prompts

# Design Question

Should the calibration campaign **automatically lower the floor** during bootstrap to ensure sample collection? Tradeoffs:
- **Pro**: Avoids the catch-22, always collects data
- **Con**: Evaluates context that wouldn't normally be injected (noisy signal)
- **Con**: Changes behavior during calibration vs normal operation

Current design assumes floor is already reasonable for the corpus. If it's not, you're stuck.

# Detection

Run `/context-status --cost` and check:
- Injection rate very low (<20%)
- Calibration: 0/N samples collected
- Most queries marked "below_floor" in usage.jsonl

If all three are true, the floor is probably too strict for this corpus.

# Workaround

Check recent prompts to see typical similarity scores:
```bash
cat ~/.contextus/logs/usage.jsonl | grep below_floor | tail -10 | jq '.best_match_score'
```

If scores are consistently 0.6-0.7 but floor is 0.725, either:
- Lower floor temporarily for calibration
- Add more diverse patterns to corpus to improve match rates
