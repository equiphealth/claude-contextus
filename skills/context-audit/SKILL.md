---
name: context-audit
description: Audit corpus quality — structural issues (missing frontmatter, type mismatches), staleness (not modified in 6+ months), and usage patterns (not retrieved). Comprehensive health check with suggested fixes.
---

# Context Audit

Comprehensive corpus quality audit covering structure, staleness, and usage. Catches issues before they degrade retrieval quality.

## When to Use

- After bulk migrations or doc creation
- Periodic maintenance (monthly/quarterly)
- When `/context-status` shows unexpected type distributions
- After major project changes
- Before a full re-embed to catch issues upfront

## Audit Modes

**Three complementary checks** (run individually or together):

1. **Structure audit** (`--structure` or default) — Frontmatter quality, type validity, duplicates
2. **Staleness audit** (`--stale`) — Files not modified in 6+ months
3. **Usage audit** (`--usage`) — Patterns never retrieved (requires Phase 1 data)

## Configuration

Docs coverage is gated by `config.docs.requireFrontmatter` in plugin.json (set during
`/contextus-setup`):

- **`true`** → audit checks docs for missing/invalid frontmatter (full coverage)
- **`false`** (default) → audit skips docs entirely; only `.claude/context/` is checked
- **`--docs-only` / `--include-docs`** flags override the config for a single run

## What It Checks

### Structure Audit (default)

Both context files AND docs (when docs coverage is enabled):

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

Context files only (exempt for docs):

| Check | Issue | Fix |
|---|---|---|
| **Prefix↔type mismatch** | Filename prefix disagrees with `metadata.type` | Rename file or fix type |
| **Wrong directory** | File in `decisions/` but type is `gotcha` | Move to correct folder |

### Staleness Audit (`--stale`)

Files not modified in 6+ months (configurable threshold):

| Check | Issue | Action |
|---|---|---|
| **Old + contradicted** | Newer context file disagrees | Archive or update |
| **Old + code missing** | Referenced patterns no longer exist | Archive or update |
| **Old + never retrieved** | Not retrieved in 6+ months (requires usage data) | Archive or improve keywords |
| **Old + still relevant** | Recent commit references or retrievals | Keep, mark as reviewed |

### Usage Audit (`--usage`)

Patterns never retrieved (requires Phase 1 usage evaluation data):

| Check | Issue | Action |
|---|---|---|
| **Zero retrievals** | Never retrieved in any session | Archive or improve keywords |
| **Low score** | Retrieved but always scored < 0.2 | Rewrite or archive (noisy) |
| **Zero injections** | Retrieved but never passed injection floor | Improve content quality |

## Usage

```bash
# All audits (structure + stale + usage)
/context-audit

# Individual audits
/context-audit --structure     # Frontmatter quality only
/context-audit --stale         # Modified 6+ months ago
/context-audit --usage         # Never retrieved (needs Phase 1 data)

# Combine audits
/context-audit --structure --stale
/context-audit --stale --usage

# Scope
/context-audit --docs-only     # Only check docs/
/context-audit --context-only  # Only check .claude/context/

# Actions
/context-audit --fix           # Auto-fix safe issues
/context-audit --issues-only   # Skip clean files
/context-audit --auto-archive  # Archive stale without prompts (caution!)

# Custom staleness threshold
/context-audit --stale --months 3
/context-audit --stale --days 90
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

- `/context-stats` — Usage analytics (Phase 2)
- `/context-review` — Interactive curation workflow
- `/context-archive` — Archive patterns bulk or individually
- `/create-context` — Create properly structured context files
- `/rebuild-embeddings` — Re-embed after fixing issues
