# context-review

**Interactive corpus curation workflow** — review patterns and improve/archive/merge based on usage data.

## When to use

- After running `/context-stats` and seeing noisy or stale patterns
- Periodic corpus maintenance (monthly recommended)
- When retrieval feels noisy (high-volume, low-value injections)
- Before major refactors (prune obsolete patterns)

## How it works

1. Read usage statistics via context-stats CLI (or reuse if just run)
2. Filter by category (default: all problem patterns)
3. Present patterns with stats and suggested actions
4. For each, offer:
   - **Archive**: Move to `.claude/context/.archive/` (noise reduction)
   - **Rewrite**: Flag for manual improvement (keywords, scope, clarity)
   - **Merge**: Combine with similar pattern (deduplicate)
   - **Keep as-is**: Pattern is working correctly
5. Execute actions (stage changes, report results)

## Instructions

When this skill is invoked:

1. **Read stats** — Run context-stats CLI or reuse recent output
2. **Filter by category** (default: all problem patterns):
   - `--filter noisy`: Retrieved ≥ 10 times, score < 0.3 (false positives)
   - `--filter stale`: Not retrieved in 180 days (obsolete or undiscoverable)
   - `--filter unused`: avgWeightedScore < 0.2 (noise)
   - `--filter duplicates`: Similar filenames or content hashes (merge candidates)
   - No filter: show all problem patterns (noisy + stale + unused)
3. **Present patterns** — Show filename, score, retrieval count, category, last used
4. **For each pattern**, suggest action and ask user:
   - **Archive**: "Noisy/obsolete — move to `.archive/`?"
   - **Rewrite**: "High retrieval, low usage — needs better scope/keywords?"
   - **Merge**: "Duplicate of X — merge into one pattern?"
   - **Keep as-is**: "Working correctly (niche/correct low volume)"
5. **Execute actions**:
   - Archive: Move file to `.claude/context/.archive/`, delete LanceDB rows
   - Rewrite: Flag file for manual edit (open in editor or note in output)
   - Merge: Call `/context-merge <file1> <file2>` (LLM-assisted combine)
   - Keep: No action
6. **Stage changes**: `git add <files>`
7. **Report**: What was archived/merged, what needs manual rewrite

## Action Details

### Archive

Move file from `.claude/context/<category>/` to `.claude/context/.archive/`:
- Preserves file content (can be unarchived later)
- Removes from LanceDB (no longer retrieved)
- Staged via `git mv <file> .claude/context/.archive/`

**When:** Pattern is obsolete, or high retrieval + low usage (noisy)

### Rewrite

Flag pattern for manual improvement:
- Open file in editor, or
- Add to "needs rewrite" list in output
- Suggest: narrow scope, improve keywords, split if covering too many topics

**When:** Pattern is valuable but over-retrieves (broad keywords) or under-retrieves (poor keywords)

### Merge

Combine two patterns via LLM-assisted workflow:
- Call `/context-merge <file1> <file2>`
- LLM reads both, writes unified version
- User reviews merged content
- Original file1 kept, file2 archived

**When:** Duplicate content detected (same topic, different files)

### Keep as-is

No action — pattern is working correctly.

**When:** Low retrieval is expected (niche pattern), or high score confirms value

## Example Interaction

```
User: /context-review --filter noisy

Claude: Reading usage statistics...

Found 3 noisy patterns (retrieved 10+ times, score < 0.3):

1. reference/api-endpoints.md
   Score: 0.18 | Retrieved: 34 times | Category: reference
   Last used: 2026-06-20
   → Action: Archive (over-retrieves, rarely helpful)

2. gotcha/gotcha-async-timing.md
   Score: 0.27 | Retrieved: 18 times | Category: gotcha
   Last used: 2026-06-24
   → Action: Rewrite (valuable topic, needs narrower scope)

3. decision/database-choice.md
   Score: 0.24 | Retrieved: 12 times | Category: decision
   Last used: 2026-05-10
   → Action: Archive (obsolete — we've moved to new DB)

For #1 (api-endpoints.md) — Archive?
User: yes

Claude: ✓ Archived reference/api-endpoints.md

For #2 (async-timing.md) — Rewrite or Archive?
User: rewrite

Claude: ✓ Flagged for rewrite — open gotcha/gotcha-async-timing.md
  Suggestion: Narrow to specific async bug pattern (React useEffect?), not general timing

For #3 (database-choice.md) — Archive?
User: yes

Claude: ✓ Archived decision/database-choice.md

Summary:
- Archived: 2 patterns
- Flagged for rewrite: 1 pattern
- Review changes: git diff
```

## Why Not Promotion?

High-value patterns don't need promotion to CLAUDE.md — **the retrieval system already delivers them when relevant**. A pattern with score ≥ 0.7 will naturally rank higher in future retrievals.

Copying to CLAUDE.md just adds system prompt bloat and removes the semantic gate (pattern always loads, even when irrelevant).

## Requirements

- Phase 1 implementation (usage evaluation active)
- At least 5 evaluations per pattern for meaningful data
- Write access to `.claude/context/` and `.claude/context/.archive/`

## Cost

Minimal — reads local files, no LLM calls (unless user asks for advice on a specific pattern).

## Related Skills

- `/context-stats` — See the raw numbers before reviewing
- `/context-archive --stale` — Bulk archive stale patterns
- `/context-merge <file1> <file2>` — Merge duplicate patterns
- `/context-doctor` — Full health check (includes staleness detection)
- `/tag-context --suggest` — Improve discoverability via better tags
