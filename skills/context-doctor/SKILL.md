# Context Doctor

Health check and troubleshooting for contextus. Run when something feels off or you're tuning the system.

## When to Use

- After installing contextus (verify setup)
- When retrieval isn't working ("why no results?")
- When you see errors or latency spikes
- Monthly health check
- When `/context-status` shows concerning metrics

## Quick Health Check (no flags)

```
Context Doctor - Quick Health Check

Status: 🟢 Healthy

Embedding:
  ✓ Model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
  ✓ 104 files indexed, 142 chunks
  ✓ Last rebuild: 2 days ago
  ⚠ 3 files stale (2.9%) → run /rebuild-embeddings

Retrieval (last 30 days):
  ✓ Usage rate: 73% of prompts
  ✓ Avg latency: 156ms
  ℹ️ For optimization suggestions: /context-calibrate

Recent Errors:
  ✓ None (last 7 days)

Recommendations:
  - Rebuild embeddings to clear stale files
  - Run /context-calibrate for usage-driven optimization
```

## Error Log

```bash
/context-doctor --errors
```

Recent errors and warnings:

```
Recent Errors (last 7 days):

2026-06-10 14:32:15 [WARN] Chroma query timeout (2.4s)
  Query: "test setup patterns"
  → Possible cause: Large corpus, consider rebuilding

2026-06-09 09:12:03 [ERROR] Embedding failed: model not loaded
  File: new-pattern.md
  → Daemon may have crashed, restarted automatically
```

## Troubleshoot Specific Query

```bash
/context-doctor --why-no-results "how do I handle timeouts"
```

Debug why a specific query didn't retrieve results:

```
Query Analysis: "how do I handle timeouts"

Embedding: ✓ Generated (152ms)
Chroma Query: ✓ Success (12ms)

Top Results:
  1. timeout-handling.md (similarity: 0.62) ❌ below threshold (0.7)
  2. async-patterns.md (similarity: 0.58) ❌ below threshold
  3. error-recovery.md (similarity: 0.51) ❌ below threshold

Diagnosis:
  ⚠ Best match (0.62) is below similarityThreshold (0.7)
  
  Options:
    1. Lower threshold to 0.6 (may increase false positives)
    2. Add explicit "timeout" keyword to timeout-handling.md
    3. Create new pattern specifically for timeout handling

Test with lower threshold:
  /context-search "how do I handle timeouts" --threshold 0.6
```

## Implementation Status

⏳ **Not yet implemented** — requires daemon + usage logging.

When implemented:
- Query ChromaDB for hit_count metadata
- Compare file mtimes against last_embedded
- Read usage.jsonl for error events
- Provide embeddings for test queries (--why-no-results)

## Design Notes

This is the **troubleshooting + tuning** tool. Combines:
- Health check (quick status, is anything broken?)
- Calibration (tune thresholds during setup)
- Debugging (why did specific query fail?)

Complements `/context-status` (impact dashboard). Status answers "how's it helping?", doctor answers "why isn't it working?" or "how do I tune it?"
