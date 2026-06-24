---
name: implementation-skill-project-scoping-fixes
description: Fix plan to add projectId parameter to all daemon HTTP calls in skills
metadata:
  type: implementation
  tags: [skills, daemon-api, bug-fix, project-isolation]
---

# Skill Project Scoping: Fix Implementation

## Root Cause

Skills query daemon endpoints (`/introspect`, `/query`, `/reconcile`, `/health`) without passing the `project` parameter. This causes:
- **Global result pollution**: Stats show all projects mixed together
- **Silent correctness degradation**: Skill output looks reasonable but is wrong
- **Workspace confusion**: Users can't see per-project state

## Affected Skills (6 total)

| Skill | Calls | Issue | Fix |
|-------|-------|-------|-----|
| `/context-status` | `/introspect` | No `?project=` param | Add projectId to query string |
| `/context-doctor` | `/reconcile` | No `project` in body | Add projectId + cwd to body |
| `/rebuild-embeddings` | `/reconcile` | Placeholder `<name>` | Compute projectId, pass in body |
| `/contextus-upgrade` | `/health` | (OK — no scoping needed) | No change |
| `/manage-daemon` | `/health` | (OK — daemon-global) | No change |
| `/contextus-watch` | (log tail only) | (OK — no scoping needed) | No change |

## Implementation Checklist

### 1. `/context-status` — Query String Parameter

**Current:**
```bash
curl -s "http://127.0.0.1:37800/introspect?project=<name>"
```

**Problem:** Documentation shows placeholder `<name>`, not computed hash.

**Fix:**
```bash
# Compute projectId hash
PROJECT_ID=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)

# Query with correct project parameter
curl -s "http://127.0.0.1:37800/introspect?project=${PROJECT_ID}"
```

**Files to update:**
- `skills/context-status/SKILL.md` — Update bash example + implementation section
- `skills/ctx-status/SKILL.md` — Same (alias)

---

### 2. `/context-doctor` — POST Body Parameter

**Current:**
```bash
curl -s -X POST 127.0.0.1:37800/reconcile \
  -H 'content-type: application/json' \
  -d "{\"cwd\":\"$PWD\",\"check\":true}" | jq
```

**Problem:** Missing `project` field in JSON body.

**Fix:**
```bash
# Compute projectId hash
PROJECT_ID=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)

# POST with projectId in body
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJECT_ID}\",\"cwd\":\"$(pwd)\",\"check\":true}"
```

**Files to update:**
- `skills/context-doctor/SKILL.md` — Reconcile call + implementation section
- `skills/ctx-doctor/SKILL.md` — Same (alias)

---

### 3. `/rebuild-embeddings` — POST Body Parameter

**Current:**
```bash
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d '{"project": "<name>", "cwd": "'"$(pwd)"'"}'
```

**Problem:** Placeholder `<name>` instead of computed projectId.

**Fix:**
```bash
# Compute projectId hash
PROJECT_ID=$(echo -n "$(pwd)" | sha256sum | cut -c1-12)

# POST with computed projectId
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJECT_ID}\",\"cwd\":\"$(pwd)\"}"
```

**Files to update:**
- `skills/rebuild-embeddings/SKILL.md` — Reconcile call + implementation section

---

### 4. `/contextus-upgrade` — No Change Required

**Status:** ✓ OK  
**Reason:** Only calls `/health` which is daemon-global (no per-project scoping)

---

### 5. `/manage-daemon` — No Change Required

**Status:** ✓ OK  
**Reason:** Only calls `/health` for liveness checks (no per-project scoping)

---

### 6. `/contextus-watch` — No Change Required

**Status:** ✓ OK  
**Reason:** Pure log tail (`tail -f ~/.contextus/logs/...`), no daemon API calls

---

## Helper Function (Optional Refactor)

Add a reusable bash helper to compute projectId in all skills:

```bash
#!/bin/bash
# lib/project-id.sh — reusable projectId computation

compute_project_id() {
  local cwd="${1:-.}"
  echo -n "$cwd" | sha256sum | cut -c1-12
}

# Usage:
# PROJECT_ID=$(compute_project_id "$(pwd)")
```

Then include in each skill that needs it:
```bash
source "$(dirname "${BASH_SOURCE[0]}")/lib/project-id.sh"
PROJECT_ID=$(compute_project_id)
```

---

## Testing

### Before fix (broken):
```bash
cd /path/to/project1
/context-status
# Shows 1,472 chunks (global, includes project2, project3, etc)

cd /path/to/project2
/context-status
# Shows same 1,472 chunks (wrong — should be project2-specific)
```

### After fix (correct):
```bash
cd /path/to/project1
/context-status
# Shows 855 chunks (project1 only)

cd /path/to/project2
/context-status
# Shows 617 chunks (project2 only)
```

---

## Rollout

1. **Update SKILL.md files** — Add projectId computation + pass to endpoints (3 files: context-status, context-doctor, rebuild-embeddings)
2. **Test each skill manually** — Verify projectId is computed and passed correctly
3. **Update gotcha documentation** — Link to implementation example
4. **Add to CHANGELOG** — "Fixed: Skills now correctly scope daemon queries to current project"

---

## Related

- `gotcha/gotcha-skill-project-scoping.md` — Root cause documentation
- `daemon/server.ts` lines 865-879 — `/introspect` endpoint handler (accepts `project` param)
- `lib/introspect.ts` lines 65-90 — `corpusStats(project?)` — scoped query implementation
