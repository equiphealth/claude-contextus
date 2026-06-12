# Context Status

Quick impact dashboard — shows what contextus is doing for you.

## Output

```
Contextus Status

Knowledge Base:
  📁 Context patterns: 68 files
  📄 Documentation: 22 files  
  🔢 Vector entries: 142 chunks

Activity (last 30 days):
  📊 Injection rate: 73% of prompts received context
  ⚡ Avg retrieval: 156ms
  📈 Growth: +12 context patterns, +5 docs

Efficiency (last 30 days):
  💾 Compression: 69% (847k injected vs 2.7M full-file baseline)
  📉 Trend: -15% tokens/injection (getting leaner)

Recent:
  ✓ Last retrieval: 2 minutes ago (logger-helper.md)
  ✓ Last capture: 4 hours ago (wdio-workaround.md)
  ✓ Last rebuild: 2 days ago

Quality: Run /context-calibrate to measure retrieval effectiveness
Details: /context-status --details
Optimize: /context-calibrate
```

## Detailed Mode

```bash
/context-status --details
```

Includes technical metrics for power users:

```
Contextus Status (Detailed)

Knowledge Base:
  📁 Context patterns: 68 files
  📄 Documentation: 22 files  
  🔢 Vector entries: 142 chunks
  🗄️  Database: ~/.contextus/data/automation/ (4.2 MB)

Activity (last 30 days):
  📊 Injection rate: 73% of prompts received context
     ├─ Injected: 620 prompts
     ├─ Skipped (below floor): 228 prompts (27%)
     └─ Total: 848 prompts
  ⚡ Retrieval latency: 156ms (p50), 278ms (p95)
  🎯 Avg similarity: 0.79

Efficiency (last 30 days):
  💾 Compression: 69% (847k injected vs 2.7M full-file baseline)
  📉 Trend: -15% tokens/injection (getting leaner)
  📈 Growth: +12 context patterns, +5 docs

Quality:
  Last calibration: 67 days ago (2026-04-06)
  ⚠ Recommend re-calibration (target: every 3-6 months)
  Run: /context-calibrate --start

Embedding:
  Model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
  Last rebuild: 2 days ago
  ⚠ 3 files stale (2.9%) → run /rebuild-embeddings

Configuration:
  topK: 5
  injectionFloor: 0.65
  similarityThreshold: 0.7
  dedupThreshold: 0.85
  captureMode: propose

Recent Errors:
  ✓ None (last 7 days)

Recent Activity:
  ✓ Last retrieval: 2 minutes ago (logger-helper.md)
  ✓ Last capture: 4 hours ago (wdio-workaround.md)
  ✓ Last rebuild: 2 days ago

Troubleshoot: /context-doctor
Measure quality: /context-calibrate
```

## What It Shows

### Knowledge Base
- **Context patterns**: Files in `.claude/context/`
- **Documentation**: Files in `docs/` (if enabled)
- **Vector entries**: Total chunks (after splitting long docs)

### Activity Metrics
- **Injection rate**: % of prompts that received context (rest skipped by injection floor)
- **Avg retrieval**: Typical query latency

### Efficiency Metrics
- **Compression**: Ratio of injected tokens vs full-file baseline (measures compression pipeline efficiency, not retrieval quality)
- **Trend**: Change in tokens/injection over time (negative = getting leaner)

### Growth Tracking
- New context patterns added (by mtime)
- New docs added (by mtime)

### Recent Activity
- Last successful retrieval (what pattern, when)
- Last capture (new pattern created, when)
- Last embedding rebuild

## Implementation

Requires:
1. **Filesystem scan**: Count files, filter by mtime for growth
2. **Usage log**: `~/.contextus/usage.jsonl` with per-prompt entries:
   ```json
   {
     "timestamp": "2026-06-12T14:23:42Z",
     "retrieved": ["logger-helper", "test-data"],
     "tokens_injected": 542,
     "tokens_saved": 1205,
     "latency_ms": 163
   }
   ```
3. **Aggregate last 30 days**: Parse usage log, sum tokens_saved, calc usage rate

## Design Notes

This is the **user-facing** dashboard. Non-technical, focuses on **value delivered**:
- "How much is this helping me?" (tokens saved, usage rate)
- "Is it growing?" (new patterns/docs)
- "Is it working?" (recent activity)

Technical tuning metrics (zero-hit patterns, staleness, threshold calibration) live in `/context-calibrate`.
