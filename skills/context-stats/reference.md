# context-stats — Reference

**Full implementation guide** for the `/context-stats` skill.

## How it works

Reads `usage-ratings.jsonl` (Phase 1 eval data) and `usage.jsonl` (retrieval events) to compute per-pattern statistics. Also includes corpus metadata (total files, last embedded timestamp) in output.

Output includes:
- **Corpus**: Total file count and last-embedded date
- **Most useful**: High weighted score, min 5 evals
- **Never retrieved**: Files in corpus with 0 retrievals
- **Noisy**: High retrieval count but low usage score
- **Stale**: Not retrieved in 6+ months

**The CLI is self-contained** — no need to run supplemental bash commands for corpus size or timestamps.

## Implementation

```bash
# Detect contextus installation (queries daemon, falls back to search)
CONTEXTUS_ROOT=$(bash ~/.contextus/scripts/find-contextus-root.sh) || exit 1
$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/context-stats.ts [options]
```

**Discovery**: Uses fixed-location script at `~/.contextus/scripts/find-contextus-root.sh` which queries the daemon for `installRoot` (authoritative), then searches standard locations (`~/.claude/plugins/contextus`, `~/src/claude-contextus`, `~/dev/claude-contextus`).

### Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--project <name>` | Target project (name, hash, or path) | Current directory (sha256) |
| `--window N` | Days of history to analyze | 30 |
| `--all` | Analyze all history (no time window) | - |
| `--json` | Output JSON instead of human-readable | - |
| `--cost` | Include eval cost breakdown | - |

### Examples

```bash
# Detect contextus location once, then use it
CONTEXTUS_ROOT=$(bash ~/.contextus/scripts/find-contextus-root.sh) || exit 1
TSX=$CONTEXTUS_ROOT/node_modules/.bin/tsx
STATS="$TSX $CONTEXTUS_ROOT/scripts/cli/context-stats.ts"

# Current project, last 30 days
$STATS

# Specific project, last 7 days with cost
$STATS --project automation --window 7 --cost

# All history as JSON
$STATS --all --json
```

## Interpreting Results

### Top 10 Most Useful
Patterns with high weighted scores (min 5 evaluations). These are high-value patterns that are working well (informational only).

### Noisy Patterns
Retrieved frequently but low usage scores (< 0.3). These are false positives — the retrieval is matching but the content isn't helping.

**Causes:**
- Generic keywords causing over-retrieval
- Outdated information that was useful once but isn't now
- Overly broad pattern coverage

**Fix:** Rewrite for specificity, add more targeted keywords, or archive

### Stale Patterns
Not retrieved in 6+ months. May be obsolete, may need better keywords, or may be niche patterns that rarely apply.

**Action:** Review content — if still relevant, improve keywords to help discoverability. If obsolete, archive.

### Never Retrieved
Files in corpus with zero retrieval events. Either:
1. Genuinely unused (archive or delete)
2. Keywords don't match how users phrase questions (improve frontmatter)
3. Too new to have data yet (wait)

## Related Skills

- `/context-review` — Interactive curation workflow
- `/context-archive` — Move stale patterns out of active corpus
- `/context-doctor` — Full health check (includes staleness detection)
- `/tag-context --suggest` — AI-suggested tags based on co-occurrence

## Requirements

- Phase 1 implementation (usage evaluation active)
- At least 5-10 evaluations for meaningful statistics
- `usage-ratings.jsonl` and `usage.jsonl` logs present

## Cost

Zero — reads local JSONL files only, no LLM calls.

## Output Format

### Human-Readable
```
## Context Usage Analytics: claude-contextus
Window: last 30 days

Corpus: 42 files (last embedded: 2026-06-30)
Total Queries (with injection): 67
Total Evaluations: 207
Avg Weighted Score: 0.73

## Top 10 Most Useful (min 5 evals)
...
```

### JSON (with --json flag)
```json
{
  "project": "claude-contextus",
  "windowDays": 30,
  "corpus": {
    "totalFiles": 42,
    "lastEmbedded": "2026-06-30"
  },
  "summary": {
    "totalQueries": 67,
    "totalEvaluations": 207,
    "avgWeightedScore": 0.73,
    "estimatedCost": 0.062
  },
  "patterns": [...]
}
```

**Note**: Corpus metadata is included automatically — no need to query it separately.
