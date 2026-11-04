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

All daemon HTTP calls from skills must pass a project identifier — and the
identifier should be the absolute path (or `cwd`), NOT a hand-computed hash.
The daemon canonicalizes hash/name/path server-side (`resolveProjectId` +
`projectHash(cwd)` fallback), so hand-hashing in shell only adds a way to get
it wrong (`echo -n` is not portable; a wrong hash silently lazy-registers a
phantom project):

```bash
# Example: /introspect — pass the path, daemon hashes it
curl -s "http://127.0.0.1:37800/introspect?project=$(pwd)"

# Example: POST /query with project in body (cwd does the scoping work)
curl -X POST -H "Content-Type: application/json" \
  -d "{\"project\":\"$(pwd)\",\"cwd\":\"$(pwd)\",\"prompt\":\"...\"}" \
  http://127.0.0.1:37800/query
```

## How projectId is Computed

The daemon computes project identity as:
```javascript
projectId = sha256(absolutePath).slice(0, 12)
```

Where `absolutePath` is the absolute filesystem path to the project root (e.g., `/Users/alice/src/my-project`).

This ensures:
- Same absolute path on different machines = same hash (portable across shared workspaces)
- Different paths (including two clones of one repo) = different hashes (collision-free — but note this means renames/moves orphan the old corpus; see the adopt-on-move plan)
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

# 2. Query /introspect with the path — the daemon resolves it to the canonical hash
curl -s "http://127.0.0.1:37800/introspect?project=${PROJECT_PATH}" \
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
curl -s "http://127.0.0.1:37800/introspect?project=$(pwd)" \
  | jq '.corpus.chunks'
# => 855 (claude-contextus only)
```

The gap (617 chunks) is context from other projects in the unified DB that should NOT appear in this project's status.
