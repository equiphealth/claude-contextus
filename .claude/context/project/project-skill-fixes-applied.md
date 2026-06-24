---
name: project-skill-fixes-applied
description: Applied projectId scoping fix to all daemon-querying skills
metadata:
  type: project
  tags: [skills, bug-fix, project-isolation, 2026-06-24]
---

# Skill Project Scoping Fixes Applied

## Summary

Fixed 3 skills that were querying the daemon without per-project scoping, causing global corpus stats to be reported instead of project-specific stats.

## Changes Made

### 1. `/context-status` — Fixed
**File:** `skills/context-status/SKILL.md` (lines 133-137)

**Before:**
```bash
curl -s "http://127.0.0.1:37800/introspect?project=<name>"
```

**After:**
```bash
PROJECT_ID=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -s "http://127.0.0.1:37800/introspect?project=${PROJECT_ID}"
```

**Impact:** Dashboard now shows correct per-project chunk count (902 for claude-contextus, not 1,472 global).

---

### 2. `/context-doctor` — Fixed
**File:** `skills/context-doctor/SKILL.md` (lines 32-35)

**Before:**
```bash
curl -s -X POST 127.0.0.1:37800/reconcile \
  -H 'content-type: application/json' \
  -d "{\"cwd\":\"$PWD\",\"check\":true}" | jq
```

**After:**
```bash
PROJECT_ID=$(echo -n "$PWD" | sha256sum | cut -c1-12)
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJECT_ID}\",\"cwd\":\"$PWD\",\"check\":true}" | jq
```

**Impact:** Diagnostic now checks the correct project's corpus, not global state.

---

### 3. `/rebuild-embeddings` — Fixed
**File:** `skills/rebuild-embeddings/SKILL.md` (lines 54-57)

**Before:**
```bash
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d '{"project": "<name>", "cwd": "'"$(pwd)"'"}'
```

**After:**
```bash
PROJECT_ID=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJECT_ID}\",\"cwd\":\"$(pwd)\"}"
```

**Impact:** Rebuild now targets only the current project's corpus.

---

## Skills That Were OK (No Changes)

- `/contextus-upgrade` — Only calls `/health` (daemon-global, no scoping needed)
- `/manage-daemon` — Only calls `/health` (daemon-global, no scoping needed)
- `/contextus-watch` — Pure log tail, no daemon API calls

---

## Testing

Verified with manual curl calls:

```bash
# Before fix: 1,472 chunks (global, all projects mixed)
curl -s http://127.0.0.1:37800/introspect | jq '.corpus.chunks'

# After fix: 902 chunks (claude-contextus only)
projectId=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)
curl -s "http://127.0.0.1:37800/introspect?project=${projectId}" | jq '.corpus.chunks'
```

---

## Related Documentation

- `gotcha/gotcha-skill-project-scoping.md` — Root cause + impact analysis
- `implementation/implementation-skill-project-scoping-fixes.md` — Detailed fix plan

## Date

2026-06-24, 9:23am EDT
