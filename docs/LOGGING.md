# Logging Schema

Dual-format logging for analytics + human readability.

## File Structure

```
~/.contextus/logs/
├── usage.jsonl          # Structured retrieval + capture events
├── daemon.log           # Human-readable daemon activity
├── errors.jsonl         # Structured error events  
└── archive/
    ├── usage-2026-05.jsonl.gz
    └── daemon-2026-05.log.gz
```

**Rotation**: Keep 30 days active, compress monthly archives, delete >6 months

## usage.jsonl (JSONL Format)

One line per retrieval or capture event. Machine-readable for analytics.

### Retrieval Event

```json
{
  "type": "retrieval",
  "timestamp": "2026-06-12T14:23:42.156Z",
  "project": "automation",
  "prompt_hash": "a3f5c9d2",
  "retrieved": ["logger-helper", "test-data-setup"],
  "tokens_injected": 542,
  "tokens_full_files": 1747,
  "tokens_saved": 1205,
  "latency_ms": 163,
  "similarity_scores": [0.87, 0.81],
  "source_breakdown": {"projectContext": 2}
}
```

**Fields**:
- `prompt_hash`: First 8 chars of SHA-256 (privacy, but allows dedup)
- `tokens_full_files`: Total if we injected entire source files uncompressed
- `tokens_saved`: `tokens_full_files - tokens_injected` (compression benefit)
- `similarity_scores`: Top result scores (for threshold analysis)

### No-Results Event

```json
{
  "type": "retrieval",
  "timestamp": "2026-06-12T14:25:10.032Z",
  "project": "automation",
  "prompt_hash": "b7e2a1f8",
  "retrieved": [],
  "tokens_injected": 0,
  "tokens_full_files": 0,
  "tokens_saved": 0,
  "latency_ms": 87,
  "reason": "below_threshold",
  "best_match_score": 0.62
}
```

### Capture Event

```json
{
  "type": "capture",
  "timestamp": "2026-06-12T09:12:45.234Z",
  "project": "automation",
  "pattern_name": "wdio-element-workaround",
  "mode": "propose",
  "approved": true,
  "word_count": 142,
  "category": "testing"
}
```

### Rebuild Event

```json
{
  "type": "rebuild",
  "timestamp": "2026-06-11T14:23:42.000Z",
  "project": "automation",
  "trigger": "manual",
  "files_processed": 104,
  "chunks_created": 142,
  "duration_ms": 18420,
  "model": "nomic-ai/nomic-embed-text-v1.5"
}
```

## errors.jsonl (JSONL Format)

One line per error/warning. Structured for alerting + analysis.

```json
{
  "level": "error",
  "timestamp": "2026-06-12T09:12:03.456Z",
  "component": "embedder",
  "error": "Model not loaded",
  "context": {
    "file": "new-pattern.md",
    "model": "nomic-ai/nomic-embed-text-v1.5"
  },
  "action_taken": "daemon_restart"
}
```

```json
{
  "level": "warn",
  "timestamp": "2026-06-10T14:32:15.123Z",
  "component": "chroma",
  "error": "Query timeout",
  "context": {
    "timeout_ms": 2400,
    "collection": "automation"
  },
  "action_taken": "retry_succeeded"
}
```

## daemon.log (Human-Readable Text)

Structured logging format: `[timestamp] [LEVEL] message (key=value, ...)`

```
[2026-06-12 14:23:42.156] INFO Retrieved 2 patterns (latency=163ms, tokens_saved=1205, project=automation)
[2026-06-12 14:25:10.032] INFO No retrieval (reason=below_threshold, best=0.62, project=automation)
[2026-06-12 14:32:15.123] WARN Chroma query timeout (timeout=2400ms, retrying, project=automation)
[2026-06-12 09:12:03.456] ERROR Embedding failed (error="Model not loaded", file=new-pattern.md, restarting_daemon)
[2026-06-11 14:23:42.000] INFO Rebuild complete (files=104, chunks=142, duration=18.4s, project=automation)
[2026-06-12 08:00:00.000] INFO Daemon started (pid=12345, model=nomic-ai/nomic-embed-text-v1.5)
[2026-06-12 22:00:00.000] INFO Daemon stopped (uptime=14h, total_queries=847)
```

**Format rules**:
- Timestamp: ISO local time, milliseconds
- Level: INFO, WARN, ERROR
- Message: Human-readable sentence
- Key-value pairs in parentheses for structured data

## Viewing Logs

### /context-logs Skill

Formats JSONL into readable output:

```bash
/context-logs              # Last 24 hours
/context-logs --errors     # Errors only
/context-logs --tail       # Live tail (watch mode)
/context-logs --since 3d   # Last 3 days
```

Output:
```
Recent Activity (last 24 hours)

14:23:42  ✓ Retrieved: logger-helper.md, test-data.md
          Tokens: 542 injected, 1205 saved (69% compression)
          Latency: 163ms

14:25:10  ○ No retrieval (best match: 0.62 vs threshold 0.7)

14:32:15  ⚠ Warning: Chroma timeout (2.4s, retry succeeded)

09:12:03  ❌ Error: Embedding failed (model not loaded)
          File: new-pattern.md
          Action: Daemon restarted
```

## Log Rotation

Automatic rotation via simple script (called by daemon on startup):

```bash
# Compress logs older than 30 days
find ~/.contextus/logs/ -name "*.jsonl" -mtime +30 -exec gzip {} \;
find ~/.contextus/logs/ -name "*.log" -mtime +30 -exec gzip {} \;

# Move to archive
mv ~/.contextus/logs/*.gz ~/.contextus/logs/archive/

# Delete archives older than 6 months
find ~/.contextus/logs/archive/ -name "*.gz" -mtime +180 -delete
```

## Implementation Notes

### Dual Write

Daemon writes both formats on every event:

```typescript
function logRetrieval(event: RetrievalEvent) {
  // Write JSONL (for analytics)
  appendFileSync('usage.jsonl', JSON.stringify(event) + '\n');
  
  // Write human-readable (for live monitoring)
  const msg = `Retrieved ${event.retrieved.length} patterns ` +
              `(latency=${event.latency_ms}ms, tokens_saved=${event.tokens_saved})`;
  log.info(msg, { project: event.project });
}
```

### Log Aggregation

`/context-status` and `/context-calibrate` parse JSONL:

```typescript
function aggregateLast30Days(): UsageStats {
  const lines = readFileSync('usage.jsonl', 'utf-8').split('\n');
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  
  return lines
    .filter(line => line.trim())
    .map(line => JSON.parse(line))
    .filter(event => new Date(event.timestamp).getTime() > thirtyDaysAgo)
    .reduce((stats, event) => {
      stats.total_retrievals++;
      stats.tokens_saved += event.tokens_saved;
      // ... aggregate other metrics
      return stats;
    }, { total_retrievals: 0, tokens_saved: 0 });
}
```

## Privacy

- **No prompt text stored** — only SHA-256 hash (first 8 chars)
- **No pattern content** — only filenames
- Logs stored in user home dir (`~/.contextus/logs/`)
- Not transmitted anywhere (local only)

## Performance

- **JSONL append**: O(1), ~0.1ms per event
- **daemon.log write**: O(1), ~0.1ms per line
- Total overhead per retrieval: ~0.2ms (<0.1% of 200ms budget)
