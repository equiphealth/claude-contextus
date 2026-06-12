# Context Debug / Dashboard

Show embedding status, retrieval quality metrics, and calibration guidance.

## When to Use

- After installing contextus (verify setup)
- During calibration phase (tune thresholds)
- When retrieval quality feels off
- Before switching from `propose` to `auto` mode
- Monthly health check

## What It Shows

### Embedding Status

```
Embedding Model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
Last Rebuild: 2026-06-11 14:23:42 (2 days ago)
Database: ~/.claude/contextus/data/automation/ (4.2 MB)

Files Indexed:
  ✓ projectContext: 68 files
  ✓ projectDocs: 22 files  
  ✓ userContext: 14 files
  Total: 104 files, 142 chunks

Staleness:
  ⚠ 3 files modified since last embed (2.9%)
  → Run /rebuild-embeddings to refresh
```

### Retrieval Quality (Last 30 Sessions)

```
Hit Rate Analysis:
  High-frequency patterns (10+ hits): 12 files
  Medium-frequency (3-9 hits): 28 files
  Low-frequency (1-2 hits): 41 files
  Zero-hit patterns: 23 files ⚠

Top Retrieved Patterns:
  1. wdio-element-visibility (47 hits)
  2. logger-helper (34 hits)
  3. test-data-setup (29 hits)

Zero-Hit Patterns (candidates for review):
  - old-api-endpoint.md (last hit: never, created 4 months ago)
  - temp-workaround.md (last hit: never, created 2 months ago)
```

### Configuration

```
Config: .claude/settings.json

Retrieval:
  topK: 5
  similarityThreshold: 0.7
  dedupThreshold: 0.85
  maxTokens: 3000

Capture:
  mode: propose ℹ️ (switch to 'auto' once calibrated)

Sources:
  ✓ projectContext: .claude/context
  ✓ projectDocs: docs  
  ✓ userContext: ~/.claude/contextus/user-context
  ✗ userDocs: disabled
```

### Calibration Guidance

```
Status: 🟡 Calibration recommended

Observations:
  ✓ 104 files indexed, good corpus size
  ⚠ 23 zero-hit patterns after 30 sessions
    → Review for relevance or consider deletion
  ⚠ 3 stale files detected
    → Run /rebuild-embeddings
  ℹ️ Running in 'propose' mode
    → Switch to 'auto' once thresholds feel right

Suggestions:
  1. Review zero-hit patterns: /context-search "topic" to test retrieval
  2. If you see [similar: x] proposals that should be separate:
     → Lower dedupThreshold (currently 0.85)
  3. If you see [new] proposals that are duplicates:
     → Raise dedupThreshold
  4. Run A/B test: try MiniLM model on same queries for comparison
```

## Usage

```bash
/context-debug
```

### Flags

```bash
/context-debug --zero-hits   # Show only zero-hit patterns with details
/context-debug --stale       # Show only stale files needing re-embed
/context-debug --config      # Show configuration only (no metrics)
```

## Implementation Status

⏳ **Not yet implemented** — requires daemon + ChromaDB integration.

When implemented:
- Query ChromaDB for hit_count metadata (from retrieval frequency tracking)
- Compare file mtimes against last_embedded timestamps
- Read config from `.claude/settings.json`
- Calculate corpus size from DB stats

## Design Notes

This is the primary calibration tool. Users run it to:
1. Verify embeddings are up to date
2. Identify patterns that aren't being retrieved (zero-hit)
3. Decide when to switch from `propose` → `auto` mode
4. Debug retrieval quality issues

The "Calibration Guidance" section should be opinionated and actionable, not just raw stats.
