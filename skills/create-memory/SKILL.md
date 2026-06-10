# Create or Update Memory

Smart memory management: creates new memories or updates existing ones automatically.

## When to Use

Anytime you want to capture a pattern, decision, or learning. The skill automatically:
- Checks if similar memory exists
- Routes to update if found
- Creates new if not found

You don't choose — it chooses for you.

## Usage

```bash
# Basic (skill decides: create or update)
/create-memory "typescript strict mode" "We use strict mode to avoid runtime errors"

# Force create new (skip similarity check)
/create-memory "topic" "context" --force-new

# Specify category
/create-memory "topic" "context" --category framework

# Specify type
/create-memory "topic" "context" --type decision
```

## How It Works

### 1. Similarity Check (automatic)

```
/create-memory "use logger helper" "Always use getLogger() for logging"

→ Semantic search existing memories
→ Found: framework/feedback_use_logger_helper.md (similarity: 0.94)
→ Decision: UPDATE existing (very similar)
→ Routes to /update-memory automatically
```

### 2. Create New (if no match)

```
/create-memory "new sdx pattern" "SDK users need encryption..."

→ Semantic search existing memories  
→ No similar memory found (best match: 0.42)
→ Decision: CREATE new
→ Creates sdk/feedback_sdk_encryption.md
```

### 3. Threshold Logic

| Similarity | Action | Reason |
|-----------|--------|---------|
| ≥ 0.90 | **Update** existing | Very similar, definitely same topic |
| 0.75-0.89 | **Ask user** | Similar, might be same or related |
| < 0.75 | **Create** new | Different enough to warrant new memory |

## Interactive Disambiguation

When similarity is 0.75-0.89:

```
Found similar memory:
  framework/feedback_typescript_patterns.md (similarity: 0.82)
  "TypeScript conventions and best practices"
  Last modified: 2 months ago

Is this about the same topic? 
  [Update existing] [Create new] [Show me both]
```

## Automatic Routing

**Update path:**
```
/create-memory "logger usage" "Use getLogger()..."

→ Found framework/feedback_use_logger_helper.md (0.96)
→ Automatically invoking /update-memory
→ Opening editor with existing content...
→ [You add new context to existing memory]
```

**Create path:**
```
/create-memory "new pattern" "..."

→ No similar memory (best: 0.41)
→ Creating new memory...
→ Created framework/feedback_new_pattern.md
```

## Footer Integration

Claude's footer triggers this automatically:

```
Memory: propose: typescript-strict-mode

→ Claude invokes: /create-memory "typescript-strict-mode" "<context from conversation>"
→ Skill checks similarity
→ Routes to /update-memory OR creates new
→ User reviews result
```

## Force New (skip check)

```bash
/create-memory "topic" "context" --force-new
```

Use when:
- You KNOW it's a new topic
- Similar memory exists but covers different angle
- Want to split a broad memory into specific ones

## Configuration

```json
{
  "claudeContextus": {
    "memoryCapture": {
      "similarityThreshold": 0.75,  // When to consider "similar"
      "autoUpdateThreshold": 0.90,  // When to auto-update without asking
      "checkSimilarity": true        // Can disable to always create
    }
  }
}
```

## Example Workflows

### Workflow 1: Update Detected

```
User: "We switched from Jest to Vitest"
Claude: Memory: propose: test-framework-change

/create-memory "test-framework-change" "Switched from Jest to Vitest..."

→ Found: framework/feedback_use_jest.md (similarity: 0.93)
→ Routing to /update-memory...
→ Opening editor with Jest memory...
→ [You update "Jest" → "Vitest" throughout]
→ ✓ Updated framework/feedback_use_vitest.md
```

### Workflow 2: New Memory

```
User: "New SDK pattern for encryption"
Claude: Memory: propose: sdk-encryption-pattern

/create-memory "sdk-encryption-pattern" "SDK users must encrypt passwords..."

→ Searching existing memories...
→ Best match: sdk/reference_sdk_helper.md (similarity: 0.54)
→ Not similar enough, creating new memory
→ Created sdk/feedback_sdk_encryption.md
→ ✓ Added to MEMORY.md index
```

### Workflow 3: User Disambiguation

```
/create-memory "error handling" "Use try-catch for API calls"

→ Found: framework/feedback_error_logging.md (similarity: 0.79)
→ Similar, but not identical. What would you like to do?

[1] Update existing memory (add API error handling section)
[2] Create new memory (API-specific error handling)
[3] Show me the existing memory first

→ [User picks 2]
→ Creating framework/feedback_api_error_handling.md
```

## Related Skills

- `/update-memory` - Directly update (if you know which one)
- `/audit-stale` - Find memories needing updates
- `/search-memory` - Find similar memories manually
