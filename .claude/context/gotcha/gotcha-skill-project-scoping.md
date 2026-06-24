---
name: gotcha-skill-project-scoping
description: Skills must compute and pass projectId hash to daemon endpoints for correct per-project isolation
metadata:
  type: gotcha
  tags: [skills, daemon-api, project-isolation, unified-db]
---

# Skill Project Scoping: Must Pass projectId to Daemon

## Problem

The contextus daemon supports per-project scoping via the unified LanceDB. However, **HTTP endpoints don't automatically know which project is calling them**. Skills querying `/introspect` or `/query` without a project parameter get **global results** (all projects in the unified DB), not project-specific results.

**Result:** A skill like `/context-status` reports corpus stats for ALL projects instead of just the current one.

## The Fix

All daemon HTTP calls from skills must compute and pass the `projectId` query parameter:

```bash
# Compute projectId (same as daemon does)
cwd=$(pwd)  # or resolve from manifest
projectId=$(echo -n "$cwd" | sha256sum | cut -c1-12)

# Example: /introspect
curl -s "http://127.0.0.1:37800/introspect?project=${projectId}"

# Example: POST /query with project in body
curl -X POST -H "Content-Type: application/json" \
  -d "{\"project\":\"${projectId}\",\"prompt\":\"...\"}" \
  http://127.0.0.1:37800/query
```

## How projectId is Computed

The daemon computes project identity as:
```javascript
projectId = sha256(absolutePath).slice(0, 12)
```

Where `absolutePath` is the absolute filesystem path to the project root (e.g., `/Users/alice/src/my-project`).

This ensures:
- Same project at different paths = same hash (portable)
- Different projects = different hashes (collision-free)
- Opaque (not leaking paths in logs)

## Where Project Parameter Goes

| Endpoint | Method | Location | Example |
|----------|--------|----------|---------|
| `/introspect` | GET | Query string | `/introspect?project=abc123` |
| `/query` | POST | Request body | `{"project":"abc123","prompt":"..."}` |
| `/notify` | POST | Request body | `{"project":"abc123","file":"..."}` |
| `/reconcile` | POST | Request body | `{"project":"abc123","cwd":"..."}` |
| `/capture` | POST | Request body | `{"project":"abc123","category":"..."}` |
| `/health` | GET | Not needed | (daemon-global, no project scoping) |

## Impact on Skills

Skills that query the daemon MUST:
1. Determine the current project's absolute path
   - From `cwd` if invoked from a project
   - From manifest (e.g., `.claude/CLAUDE.md`) if needed
2. Compute the projectId hash
3. Pass it to every daemon endpoint

**Example workflow for `/context-status`:**
```bash
# 1. Get current project path
PROJECT_PATH=$(pwd)

# 2. Compute projectId
PROJECT_ID=$(echo -n "$PROJECT_PATH" | sha256sum | cut -c1-12)

# 3. Query /introspect with projectId
curl -s "http://127.0.0.1:37800/introspect?project=${PROJECT_ID}" \
  | jq '.corpus'
```

## Which Skills Are Affected?

All skills that make daemon queries must add project scoping:
- `/context-status` — must pass project to `/introspect`
- `/context-calibrate` — must pass project to `/query` (usage eval)
- `/rebuild-embeddings` — must pass project to `/reconcile`
- `/context-doctor` — must pass project to `/introspect` + `/query`
- Any custom skills querying the daemon

## Test

Before/after check:
```bash
# Without project parameter (WRONG — global results)
curl -s "http://127.0.0.1:37800/introspect" | jq '.corpus.chunks'
# => 1472 (all projects)

# With project parameter (CORRECT — this project only)
projectId=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -s "http://127.0.0.1:37800/introspect?project=${projectId}" \
  | jq '.corpus.chunks'
# => 855 (claude-contextus only)
```

The gap (617 chunks) is context from other projects in the unified DB that should NOT appear in this project's status.
