---
name: audit-context
description: Audit context files AND docs for frontmatter quality, duplicates, missing fields, type validity, and coverage gaps. Reports fixable issues with suggested corrections.
---

# Audit Context & Docs

Structural quality audit across both `.claude/context/` and `docs/`. Checks that files
will embed well and inject correctly — catches issues before they silently degrade
retrieval quality.

## When to Use

- After bulk migrations or doc creation
- Periodic hygiene (monthly)
- When `/context-status` shows unexpected type distributions
- Before a full re-embed to catch issues upfront

## Configuration

Docs coverage is gated by `config.docs.requireFrontmatter` in plugin.json (set during
`/contextus-setup`):

- **`true`** → audit checks docs for missing/invalid frontmatter (full coverage)
- **`false`** (default) → audit skips docs entirely; only `.claude/context/` is checked
- **`--docs-only` / `--include-docs`** flags override the config for a single run

## What It Checks

### Both context files AND docs (when docs coverage is enabled):

| Check | Issue | Fix |
|---|---|---|
| **Missing frontmatter** | No YAML block at all | Add `name`, `description`, `metadata.type`, `metadata.tags` |
| **Missing name** | No `name:` field | Derive from filename slug |
| **Missing description** | No `description:` field | Suggest from first paragraph |
| **Missing type** | `metadata.type` absent or `unknown` | Suggest based on content/filename |
| **Invalid type** | Type not in valid list | Suggest nearest valid type |
| **Empty tags** | No tags at all | Suggest from content keywords |
| **Duplicate names** | Same `name:` across files | Flag for rename |
| **Near-duplicate descriptions** | High similarity between descriptions | Flag for dedup or differentiation |

### Context files only (exempt for docs):

| Check | Issue | Fix |
|---|---|---|
| **Prefix↔type mismatch** | Filename prefix disagrees with `metadata.type` | Rename file or fix type |
| **Wrong directory** | File in `decisions/` but type is `gotcha` | Move to correct folder |

## Usage

```bash
# Audit everything (context + docs)
/audit-context

# Only check docs
/audit-context --docs-only

# Only check context files
/audit-context --context-only

# Auto-fix safe issues (missing name derived from filename, etc.)
/audit-context --fix

# Show only files with issues (skip clean files)
/audit-context --issues-only
```

## Example Output

```
📊 Context & Docs Audit

.claude/context/ (68 files):
  ✓ 62 files clean
  ⚠ 4 files missing tags
  ⚠ 1 file with invalid type 'pattern' → suggest 'reference'
  ✗ 1 file with prefix/type mismatch

docs/ (12 files):
  ✓ 3 files have full frontmatter
  ⚠ 7 files missing frontmatter entirely
  ⚠ 2 files have frontmatter but missing description

Issues:

  [1] docs/calibration.md
      ✗ No frontmatter
      Suggested:
        name: calibration
        description: Calibration & tuning guide for injection floor and similarity thresholds
        type: reference
        tags: [calibration, tuning, injection-floor, threshold]

  [2] docs/usage.md
      ✗ No frontmatter
      Suggested:
        name: usage
        description: Day-to-day usage guide for capturing patterns and maintaining corpus health
        type: reference
        tags: [usage, capture, corpus, maintenance]

  [3] .claude/context/gotchas/gotcha-hook-files-esm.md
      ⚠ Missing tags
      Suggested tags: [hooks, esm, testing, commonjs]

Fix these? [Fix all] [Fix one-by-one] [Skip]
```

## Valid Types Reference

`arch`, `decision`, `tradeoff`, `gotcha`, `api`, `phase`, `project`, `schema`,
`security`, `perf`, `reference`, `implementation`

## Implementation Notes

Uses `loadContext()` from `lib/embedding/context-loader.ts` which already parses
frontmatter from both context files and docs. Files without frontmatter get
`type: 'unknown'` and empty tags — that's what this audit catches and fixes.

## Related

- `/audit-stale` — staleness/relevance audit (time-based)
- `/create-context` — create properly structured context files
- `/create-doc` — create properly structured docs
- `/rebuild-embeddings` — re-embed after fixing issues
