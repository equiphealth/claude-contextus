---
name: setup-detect-unified-db
description: setup-detect.ts must read projects.json for existingProjects, not scan for per-project lance directories
metadata:
  type: gotcha
  tags: ["setup", "unified-db", "detection"]
---

# setup-detect.ts Must Use projects.json

## The Problem

The `listExistingProjects()` function in `scripts/setup-detect.ts` was looking for **per-project LanceDB directories** at `~/.contextus/data/<project-hash>/contextus.lance`.

This is from the **old architecture** before the unified database migration. Now all projects share one database at `~/.contextus/data/contextus.lance`, and project registration is tracked in `projects.json`.

## Symptom

Setup detection always returns `existingProjects: []` even when multiple projects are registered with contextus.

## Impact

- Setup wizard can't offer "copy patterns from existing projects" option
- User thinks they're setting up contextus for the first time when they're not
- No functional breakage, just degraded UX

## The Fix

```typescript
function listExistingProjects(currentProject: string): string[] {
  try {
    // Read from projects.json (unified DB architecture)
    if (!fs.existsSync(PROJECTS_JSON)) return [];
    const raw = fs.readFileSync(PROJECTS_JSON, 'utf8');
    const projects = JSON.parse(raw) as Record<string, { name: string; path: string }>;

    // Return project names, excluding the current one
    return Object.entries(projects)
      .filter(([hash]) => hash !== currentProject)
      .map(([_, p]) => p.name)
      .filter((name, idx, arr) => arr.indexOf(name) === idx); // dedupe
  } catch {
    return [];
  }
}
```

## Why This Keeps Happening

The unified DB migration happened relatively recently. Any code that **enumerates projects** or **checks for project existence** needs to be audited:

- ✅ Detection scripts → read `projects.json`
- ✅ Daemon operations → already scoped by projectId
- ⚠️ CLI tools that list projects → check if they're using the old pattern

## Related

- `gotcha-unified-db-scoping-invariant.md` — scoping operations in the shared DB
- `gotcha-project-identifier-mismatch.md` — project hash consistency
