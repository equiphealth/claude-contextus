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

Execute silently. Prefer `curl -X POST "${CONTEXTUS_DAEMON_URL:-http://127.0.0.1:37800}/search"` directly (same daemon `/capture` talks to) over the CLI wrapper — one less subprocess, JSON you can consume directly. The daemon's port can differ from the 37800 default (env override or dynamic port file), so always respect `CONTEXTUS_DAEMON_URL` if it's set rather than hardcoding the port. Search, show results with scores.

See [./reference.md](./reference.md) for:
- Search options and filters
- Score interpretation
- Examples
