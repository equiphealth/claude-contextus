---
name: bug-documentation-lifecycle
description: How to manage gotcha/implementation documentation as bugs move from discovered → fixed → historical
metadata:
  type: decision
  tags: ["documentation", "corpus-management", "gotchas", "workflow"]
---

# Decision: Bug Documentation Lifecycle

## Context

When working on a codebase with a persistent context corpus (like contextus), bugs move through states:
1. **Discovered** — Bug exists, may or may not have workarounds
2. **Fixed** — Bug resolved via code changes
3. **Historical** — Fix is documented for future reference

Without a clear lifecycle policy, the corpus accumulates **stale gotchas** that mislead future sessions — e.g., warning about a bug that was fixed months ago.

## Decision

Bug documentation follows this lifecycle:

### Phase 1: Discovery (Bug Exists)

**Capture as**: `gotcha/gotcha-<slug>.md`

**Content**:
- Symptom description
- Root cause (if known)
- Workaround (if any)
- Impact/when it matters

**Example**:
```markdown
---
name: source-exclude-config-not-merged
description: sources.*.exclude overrides ignored — resolveSources uses raw plugin.json
metadata:
  type: gotcha
---

## Symptom
Project `.claude/contextus.json` overrides to `sources.projectDocs.exclude` are ignored.

## Root Cause
`resolveSources()` receives raw `plugin.json` instead of merged config.

## Workaround
Put exclude patterns in `plugin.jsonc` (affects all projects).
```

### Phase 2: Fix (Bug Resolved)

**Actions**:
1. Implement the fix
2. Commit the code changes
3. **Remove** the gotcha file: `rm .claude/context/gotchas/gotcha-<slug>.md`
4. **Create** implementation note: `implementation/implementation-<slug>.md`

**Implementation note content**:
- Status: FIXED + date
- What was broken
- The fix (files changed, approach)
- Verification/testing
- Why it matters

**Example**:
```markdown
---
name: source-exclude-config-not-merged
description: "FIXED 2026-07-20: sources.*.exclude patterns now merge from project config"
metadata:
  type: implementation
  tags: [fixed, config, sources]
---

**Status**: Fixed on 2026-07-20

## What Was Broken
...

## The Fix
...

## Verification
...
```

### Phase 3: Historical Context (Optional)

**When to keep implementation note**:
- Fix was non-obvious or surfaced architectural insight
- Bug affected multiple users/sessions
- Fix pattern is reusable for similar issues

**When to delete entirely**:
- Trivial bug (typo, off-by-one)
- Fix is obvious from git history
- No value for future reference

If unsure, **keep it** — disk is cheap, re-learning is expensive.

## Rationale

### Why remove the gotcha?

1. **Prevents stale advice** — A gotcha saying "X is broken, use workaround Y" becomes WRONG advice after the fix
2. **Avoids confusion** — Future sessions shouldn't see both "this is broken" and "this is fixed" for the same issue
3. **Keeps corpus clean** — Corpus quality > corpus size

### Why create implementation note?

1. **Documents the fix** — Shows what changed and why
2. **Searchable history** — Future bugs in the same area can reference the fix
3. **Avoids regressions** — Clear record of what was wrong prevents reintroduction
4. **Onboarding value** — New contributors see how issues were resolved

### Why not just update the gotcha in-place?

- **Type mismatch** — A `gotcha` is "here's a problem", an `implementation` is "here's how we solved it"
- **Search semantics** — Searching for gotchas should find ACTIVE problems, not historical fixes
- **Status clarity** — "FIXED" in frontmatter + `type: implementation` is unambiguous

## Implementation Notes

1. **Do this in the same commit** — Fix code + remove gotcha + add implementation note = atomic change
2. **Cross-reference** — Implementation note can link to the gotcha's git history if needed: `git log -- .claude/context/gotchas/gotcha-<slug>.md`
3. **Embed immediately** — If daemon auto-embeds on file changes, the old gotcha drops out and new implementation note appears
4. **Update CONTEXT.md** — Index file updates automatically via `/capture` endpoint

## Examples in Practice

### Commit message pattern:
```
fix: <one-line description>

<details>

Removed: gotchas/gotcha-<slug>.md (bug now fixed)
Added: implementation/implementation-<slug>.md (fix documentation)
```

### Session flow:
```
1. User: "X is broken"
2. Claude: Investigates, captures gotcha-x.md
3. Claude: Implements fix
4. Claude: Removes gotcha-x.md, captures implementation-x.md
5. Commit: code + context changes together
```

## Exceptions

- **Upstream bugs** — If bug is in a dependency (not our code), keep as gotcha with "UPSTREAM" tag until fixed upstream
- **Partial fixes** — If fix is incomplete, update gotcha to reflect current state, don't convert to implementation
- **Config-as-workaround** — Some "bugs" are actually config issues; convert to `reference` instead of `implementation`

## See Also

- `docs/CAPTURE_PHILOSOPHY.md` — When to capture context
- `gotchas/` directory — Active known issues
- `implementation/` directory — Fixed bugs and feature history
