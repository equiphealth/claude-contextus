---
name: context-stats
description: Usage analytics for injected context — aggregates usage evaluation data to show what's working. Reports most useful patterns, noisy patterns (high retrieval, low score), stale patterns (not retrieved in 6+ months), and never-retrieved files.
---

# context-stats

**Usage analytics for injected context** — aggregates usage evaluation data to show what's working.

## When to use

- User asks for usage statistics, pattern analytics, or corpus health
- Investigating which patterns are being used vs. ignored
- Before archiving or promoting patterns (need data to decide)
- Regular corpus maintenance (suggested: monthly)

## How it works

Reads `usage-ratings.jsonl` (Phase 1 eval data) and `usage.jsonl` (retrieval events) to compute per-pattern statistics:

- **Most useful**: High weighted score, min 5 evals
- **Never retrieved**: Files in corpus with 0 retrievals
- **Noisy**: High retrieval count but low usage score
- **Stale**: Not retrieved in 6+ months

## Instructions

When this skill is invoked:

1. Run the context-stats CLI with appropriate flags
2. Present the output to the user
3. If noisy or stale patterns are found, suggest follow-up actions:
   - **Noisy**: `/context-review --filter noisy` or manual review
   - **Stale**: `/context-archive --stale` or `/context-review`
   - **Never retrieved**: Check if the pattern is still relevant (may need better keywords)

## Implementation

```bash
npx tsx ~/.claude/plugins/contextus/scripts/cli/context-stats.ts [options]
```

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
# Current project, last 30 days
npx tsx ~/.claude/plugins/contextus/scripts/cli/context-stats.ts

# Specific project, last 7 days with cost
npx tsx ~/.claude/plugins/contextus/scripts/cli/context-stats.ts --project automation --window 7 --cost

# All history as JSON
npx tsx ~/.claude/plugins/contextus/scripts/cli/context-stats.ts --all --json
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
