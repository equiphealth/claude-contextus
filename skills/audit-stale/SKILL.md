# Audit Stale Memories

Review memories that haven't been updated recently and check if they're still relevant.

## When to Use

- Periodic maintenance (monthly/quarterly)
- After major project changes
- When context injection seems outdated
- Before a major release or documentation update

## Usage

```bash
# Review all stale memories (6+ months old)
/audit-stale

# Custom staleness threshold
/audit-stale --months 3
/audit-stale --days 90

# Only check specific category
/audit-stale --category framework
/audit-stale --category testing

# Auto-archive confirmed stale (no prompts)
/audit-stale --auto-archive
```

## What It Does

1. **Lists memories by last modified**
   - Groups by age: >6mo, 3-6mo, <3mo
   - Shows category, name, last modified date

2. **Checks relevance** (for each old memory):
   - Semantic search recent git commits
   - Check if contradicted by newer memories/docs
   - Check if referenced patterns still exist in code

3. **Suggests action** for each:
   - **Keep** - Still accurate, mark as reviewed
   - **Update** - Needs changes, opens in editor
   - **Archive** - No longer relevant, move to `.archive/`
   - **Delete** - Wrong/outdated, remove completely

## Example Output

```
📊 Stale Memory Audit

🔴 Older than 6 months (5 found):
  
  [1] framework/feedback_use_jest.md
      Last modified: 8 months ago (2025-10-10)
      ⚠️  Contradicts: framework/feedback_use_vitest.md (2 months ago)
      Action: [Keep] [Update] [Archive] [Delete]
  
  [2] sdk/reference_old_api_endpoint.md
      Last modified: 10 months ago (2025-08-15)
      ⚠️  Pattern not found in current code
      Action: [Keep] [Update] [Archive] [Delete]

🟡 3-6 months old (3 found):
  
  [3] testing/feedback_browserstack_setup.md
      Last modified: 4 months ago (2026-02-10)
      ✓ Still referenced in recent work
      Action: [Keep] [Update] [Archive] [Delete]

✅ Recent (<3 months): 56 memories - all current
```

## Interactive Mode

For each flagged memory:
1. Shows memory summary
2. Shows potential conflicts/issues
3. Asks for action
4. If "Update": Opens editor with memory file
5. If "Archive": Moves to `.claude/memory/.archive/`
6. If "Delete": Removes file and rebuilds embeddings

## Auto Mode

```bash
/audit-stale --auto-archive --older-than 12
```

Automatically archives memories:
- Older than 12 months
- Not referenced in last 6 months of commits
- Contradicted by newer memories
- No user confirmation

**Use with caution!**

## Configuration

```json
{
  "claudeContextus": {
    "maintenance": {
      "stalenessThresholdMonths": 6,
      "checkRelevanceOnAudit": true,
      "autoArchiveThresholdMonths": 12
    }
  }
}
```

## Related Skills

- `/update-memory` - Update a specific memory
- `/audit-memory` - Validate structure (not staleness)
- `/search-memory` - Find relevant memories manually
