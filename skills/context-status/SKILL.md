# Context Status

Quick impact dashboard — shows what contextus is doing for you.

## Output

```
Contextus Status

Knowledge Base:
  📁 Context patterns: 68 files
  📄 Documentation: 22 files  
  🔢 Vector entries: 142 chunks

Impact (last 30 days):
  💾 Tokens saved: ~847k (vs. full file injection)
  📊 Usage rate: 73% of prompts used context
  ⚡ Avg retrieval: 156ms

Growth (last 30 days):
  + 12 new context patterns
  + 5 new docs

Recent Activity:
  ✓ Last retrieval: 2 minutes ago (logger-helper.md)
  ✓ Last capture: 4 hours ago (wdio-workaround.md)
  ✓ Last rebuild: 2 days ago

Run /context-calibrate for detailed tuning metrics.
```

## What It Shows

### Knowledge Base
- **Context patterns**: Files in `.claude/context/`
- **Documentation**: Files in `docs/` (if enabled)
- **Vector entries**: Total chunks (after splitting long docs)

### Impact Metrics
- **Tokens saved**: Compression benefit (injected compressed patterns vs full files)
- **Usage rate**: % of prompts that retrieved context
- **Avg retrieval**: Typical query latency

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
2. **Usage log**: `~/.claude/contextus/usage.jsonl` with per-prompt entries:
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
