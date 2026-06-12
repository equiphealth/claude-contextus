# Update Context

Update an existing context file when information changes or conflicts arise.

## When to Use

- Discovered better approach that supersedes old pattern
- Information in context is now incorrect/outdated
- Need to add examples or clarification to existing context
- Semantic search found conflicting context

## Usage

```bash
# Update specific context
/update-context framework/feedback_typescript_strict.md

# Search and update
/update-context "typescript strict mode"

# Quick update with new content
/update-context framework/feedback_example.md --append "New example: ..."

# Mark as reviewed (update mtime, no content change)
/update-context sdk/reference_example.md --touch
```

## What It Does

### Interactive Mode (default)

1. **Reads current context**
2. **Shows summary** and last modified date
3. **Checks for conflicts** with other context files
4. **Opens editor** with current content
5. **You edit** the content
6. **Updates file** and rebuilds embeddings
7. **Updates CONTEXT.md** index if needed

### Append Mode

```bash
/update-context path.md --append "## New Section\n\nAdditional info..."
```

Adds content to end of existing context without full editor.

### Touch Mode

```bash
/update-context path.md --touch
```

Updates `mtime` (marks as reviewed) without content changes. Useful after audit to mark "checked, still valid."

## Pre-Update Checks

**Before opening editor, checks for:**

1. **Conflicting context**
   ```
   ⚠️  Found similar context files:
   - framework/feedback_use_jest.md (similarity: 0.89)
   - testing/reference_test_setup.md (similarity: 0.76)
   
   Consider consolidating instead? [y/n]
   ```

2. **Recent changes**
   ```
   ℹ️  This context was last updated 2 months ago by create-context skill.
   
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
Claude: "Context: update: framework/feedback_use_jest.md (now outdated)"

# You run skill
/update-context framework/feedback_use_jest.md

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
✓ Updated CONTEXT.md index
```

## Footer Integration

When Claude detects conflicts, it adds to footer:
```
Context: used: framework/feedback_typescript_strict.md
Context: update: framework/feedback_typescript_strict.md (contradicts current approach)
```

This signals: "I used this context, but it conflicts with what we're doing now."

## Conflict Resolution Strategies

### 1. Update in place
When context is mostly right, just needs refinement.

### 2. Split into two
```
Old: "Use TypeScript strict mode"
→ Split into:
  - "Use TypeScript strict mode (preferred)"
  - "When to use permissive mode (edge cases)"
```

### 3. Consolidate
```
Multiple similar context files
→ Merge into one comprehensive context
→ Archive the old ones
```

### 4. Deprecate
```
Add to context:
## Deprecated
This approach was replaced in 2026. See framework/feedback_new_approach.md
```

Then archive after next audit cycle.

## Related Skills

- `/audit-stale` - Find context files that need updates
- `/create-context` - Create new context (check first if update is better)
- `/audit-context` - Validate structure
