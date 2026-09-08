---
name: context-search
description: Search corpus by semantic similarity. Returns matching patterns with scores, descriptions, and types. Use --limit N for more results, --scores to show similarity.
---

# context-search

**Search corpus** — find patterns by semantic similarity.

## When to use

- User asks "what patterns exist about X"
- Testing retrieval behavior
- Debugging why patterns aren't appearing
- Exploring corpus content

## Instructions

Execute silently. Prefer `curl -X POST http://127.0.0.1:37800/search` directly (same daemon `/capture` talks to) over the CLI wrapper — one less subprocess, JSON you can consume directly. Search, show results with scores.

See [./reference.md](./reference.md) for:
- Search options and filters
- Score interpretation
- Examples
