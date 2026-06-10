# Update Memory

Update an existing memory file when information changes or conflicts arise.

## When to Use

- Discovered better approach that supersedes old pattern
- Information in memory is now incorrect/outdated
- Need to add examples or clarification to existing memory
- Semantic search found conflicting memory

## Usage

```bash
# Update specific memory
/update-memory framework/feedback_typescript_strict.md

# Search and update
/update-memory "typescript strict mode"

# Quick update with new content
/update-memory framework/feedback_example.md --append "New example: ..."

# Mark as reviewed (update mtime, no content change)
/update-memory sdk/reference_example.md --touch
```

## What It Does

### Interactive Mode (default)

1. **Reads current memory**
2. **Shows summary** and last modified date
3. **Checks for conflicts** with other memories
4. **Opens editor** with current content
5. **You edit** the content
6. **Updates file** and rebuilds embeddings
7. **Updates MEMORY.md** index if needed

### Append Mode

```bash
/update-memory path.md --append "## New Section\n\nAdditional info..."
```

Adds content to end of existing memory without full editor.

### Touch Mode

```bash
/update-memory path.md --touch
```

Updates `mtime` (marks as reviewed) without content changes. Useful after audit to mark "checked, still valid."

## Pre-Update Checks

**Before opening editor, checks for:**

1. **Conflicting memories**
   ```
   ⚠️  Found similar memories:
   - framework/feedback_use_jest.md (similarity: 0.89)
   - testing/reference_test_setup.md (similarity: 0.76)
   
   Consider consolidating instead? [y/n]
   ```

2. **Recent changes**
   ```
   ℹ️  This memory was last updated 2 months ago by create-memory skill.
   
   Recent git commits that might affect it:
   - "Switch from Jest to Vitest" (1 month ago)
   - "Update test patterns" (3 weeks ago)
   
   Proceed with update? [y/n]
   ```

## Example Workflow

```bash
# User discovers old info
You: "We switched from Jest to Vitest"

# Claude proposes update
Claude: "Memory: update: framework/feedback_use_jest.md (now outdated)"

# You run skill
/update-memory framework/feedback_use_jest.md

# System shows:
Found: framework/feedback_use_jest.md
Last modified: 8 months ago

Current content:
---
name: use-jest-for-testing
description: Always use Jest as test framework
type: feedback
---

# Use Jest for Testing
...

Opening editor to update...

# You edit:
---
name: use-vitest-for-testing  # Changed
description: Always use Vitest as test framework  # Changed
type: feedback
---

# Use Vitest for Testing  # Changed
We switched from Jest to Vitest in Q1 2026...  # Updated

# System confirms:
✓ Updated framework/feedback_use_vitest.md
✓ Rebuilt embeddings
✓ Updated MEMORY.md index
```

## Footer Integration

When Claude detects conflicts, it adds to footer:
```
Memory: used: framework/feedback_typescript_strict.md
Memory: update: framework/feedback_typescript_strict.md (contradicts current approach)
```

This signals: "I used this memory, but it conflicts with what we're doing now."

## Conflict Resolution Strategies

### 1. Update in place
When memory is mostly right, just needs refinement.

### 2. Split into two
```
Old: "Use TypeScript strict mode"
→ Split into:
  - "Use TypeScript strict mode (preferred)"
  - "When to use permissive mode (edge cases)"
```

### 3. Consolidate
```
Multiple similar memories
→ Merge into one comprehensive memory
→ Archive the old ones
```

### 4. Deprecate
```
Add to memory:
## Deprecated
This approach was replaced in 2026. See framework/feedback_new_approach.md
```

Then archive after next audit cycle.

## Related Skills

- `/audit-stale` - Find memories that need updates
- `/create-memory` - Create new memory (check first if update is better)
- `/audit-memory` - Validate structure
