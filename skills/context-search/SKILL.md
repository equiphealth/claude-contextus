---
name: context-search
description: Search corpus by semantic similarity. Returns matching patterns with scores, descriptions, and types. Use --limit N for more results, --scores to show similarity.
---

# Context Search

Search the contextus corpus manually — useful for exploring what's available, debugging retrieval, or testing before committing changes.

## When to Use

- Explore what patterns exist on a topic
- Debug "why didn't X get retrieved?"
- Find related patterns before creating new ones
- Test retrieval quality before committing changes
- Browse corpus without writing a prompt

## How It Works

Queries the daemon's `/query` endpoint (same as automatic retrieval) but presents ALL matches, not just those above the injection floor. This lets you see what's in the corpus even if it wouldn't normally inject.

## Usage

```bash
# Detect contextus installation
CONTEXTUS_ROOT=$(bash ~/.contextus/scripts/find-contextus-root.sh) || exit 1
SEARCH="$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/context-search.ts"

# Basic search (top 10 results)
$SEARCH "error handling patterns"

# More results with similarity scores
$SEARCH "testing patterns" --limit 20 --scores

# Specific project
$SEARCH "deployment workflow" --project automation

# JSON output for scripting
$SEARCH "api patterns" --json
```

## Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--limit N` | Max results to return | 10 |
| `--project NAME` | Target project (name, hash, or path) | Current directory |
| `--scores` | Show similarity scores | Hidden |
| `--json` | Output JSON | Human-readable |

## Example Output

```
## Search Results: "error handling patterns"

Found 5 matches:

📄 gotchas/gotcha-async-error-boundaries.md
   Async errors in React components need error boundaries at the right level
   Type: gotcha

📄 implementation/implementation-graceful-degradation.md
   Graceful degradation strategy when daemon is unreachable
   Type: implementation

📄 decisions/decision-error-reporting.md
   Use structured logging for errors, not console.error
   Type: decision
```

## Notes

- **Semantic search only** — Uses embeddings, not keyword matching
- **Current project** — Searches the corpus for your current working directory
- **All results** — Shows matches below injection floor (unlike automatic retrieval)
- **Same ranking** — Uses the same similarity scoring as automatic injection

## Related

- `/context-status` — See what's in the corpus (stats, not search)
- `/create-context` — Create new patterns (includes similarity check)
- `/context-stats` — See which patterns are actually being used
