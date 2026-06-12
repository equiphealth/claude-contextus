---
name: opus-metrics-critique
description: Opus feedback on contextus design - tokens saved is vanity metric, need real quality measurement
metadata:
  type: feedback
---

Opus reviewed contextus design (docs/opus_feedback.txt) and identified critical issues:

**Core critique**: "Tokens saved" is a vanity metric that measures against wrong baseline (full-file injection). Nobody's alternative is "inject whole files" — it's "inject nothing." The metric that actually matters is whether injected context was **used** (use_count vs hit_count).

**Why it matters**: "Tokens saved" can only go up (makes system look good) but doesn't tell you if the context was relevant. Real quality = did Claude actually use the retrieved patterns?

**Our response**: Shifted entire metrics framework:
- Demoted "tokens saved" to "Efficiency" section (compression pipeline metric, not quality)
- Added calibration evaluation mode (100 samples, explicit quality ratings)
- Lead with "Injection rate" (% prompts that got context) and quality measurements
- Separate Activity/Efficiency/Quality metrics clearly

**Design decisions from this**:
- Calibration uses Haiku to rate patterns as critical/helpful/mentioned/unused
- Thinking blocks (`preceding_reasoning` from Stop hook) provide ground truth
- Quality evaluation happens in background (async worker, zero latency)
- Metrics dashboard shows compression efficiency but directs to `/context-calibrate` for quality

**Why this was right critique**: We were designing elaborate pipeline optimization around a number that couldn't tell us if the system worked.

**Related**: [[evaluation-architecture]], [[stop-hook-design]]
