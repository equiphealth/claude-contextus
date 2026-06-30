---
name: create-context
description: Capture a new pattern/decision/implementation note into .claude/context/ with validation, deduplication, proper structure (frontmatter + body), and auto-embed.
---

# Create or Update Context

Smart context management: creates new context files or updates existing ones automatically.

## When to Use

Anytime you want to capture a pattern, decision, or learning. The skill automatically:

- Checks if similar context exists
- Routes to update if found
- Creates new if not found

You don't choose — it chooses for you.

## Usage

```bash
# Basic (skill decides: create or update)
/create-context "typescript strict mode" "We use strict mode to avoid runtime errors"

# Force create new (skip similarity check)
/create-context "topic" "content" --force-new

# Specify type (= category; one of the valid values below)
/create-context "topic" "content" --type decision
```

## File format (MUST match exactly — the embed gate rejects anything else)

A created file uses this frontmatter. Do **not** improvise the shape — a wrong schema
(e.g. top-level `type:`, a `category:` field, or an invalid type like `pattern`) fails
the prefix↔type gate and **aborts the whole embed**:

```markdown
---
name: <kebab-slug>
description: <one line — strong topical signal, gets embedded>
metadata:
  type: <one of the valid categories below>
  tags: [optional, comma, list]
---

<body>
```

**Valid `metadata.type` values (the ONLY ones — `pattern`/`note`/`misc`/`feedback` are
NOT valid):**
`arch`, `decision`, `tradeoff`, `gotcha`, `api`, `phase`, `project`, `schema`,
`security`, `perf`, `reference`, `implementation`.

**Filename MUST be `<category>/<type>-<slug>.md`** — the folder and the filename prefix
both equal `metadata.type` (e.g. `decisions/decision-use-logger-helper.md`,
`gotchas/gotcha-ios-isdisplayed-quirk.md`). The filename prefix and `metadata.type` must
agree or the file won't embed. (Rules: see CATEGORIES_AND_TAGS.md.)

> Pick the category by *what question the file answers* — `decision-` "what did we
> choose?", `gotcha-` "what bites you?", `reference-` "where/how does X work?". When
> unsure, `reference` is the safe neutral choice. Never `pattern` (not a category).

## How It Works

### 1. Similarity Check (automatic)

```
/create-context "use logger helper" "Always use getLogger() for logging"

→ Semantic search existing context files
→ Found: decisions/decision-use-logger-helper.md (similarity: 0.94)
→ Decision: UPDATE existing (very similar)
→ Routes to /update-context automatically
```

### 2. Create New (if no match)

```
/create-context "new sdx pattern" "SDK users need encryption..."

→ Semantic search existing context files
→ No similar context found (best match: 0.42)
→ Decision: CREATE new
→ Creates decisions/decision-sdk-password-encryption.md
```

### 3. Threshold Logic

| Similarity | Action              | Reason                                       |
| ---------- | ------------------- | -------------------------------------------- |
| ≥ 0.90     | **Update** existing | Very similar, definitely same topic          |
| 0.75-0.89  | **Ask user**        | Similar, might be same or related            |
| < 0.75     | **Create** new      | Different enough to warrant new context file |

## Interactive Disambiguation

When similarity is 0.75-0.89:

```
Found similar context:
  decisions/decision-typescript-patterns.md (similarity: 0.82)
  "TypeScript conventions and best practices"
  Last modified: 2 months ago

Is this about the same topic?
  [Update existing] [Create new] [Show me both]
```

## Automatic Routing

**Update path:**

```
/create-context "logger usage" "Use getLogger()..."

→ Found decisions/decision-use-logger-helper.md (0.96)
→ Automatically invoking /update-context
→ Opening editor with existing content...
→ [You add new information to existing context]
```

**Create path:**

```
/create-context "new pattern" "..."

→ No similar context (best: 0.41)
→ Creating new context file...
→ Created reference/reference-new-pattern.md
```

## Footer Integration

Claude's footer triggers this automatically:

```
Context: propose: typescript-strict-mode

→ Claude invokes: /create-context "typescript-strict-mode" "<information from conversation>"
→ Skill checks similarity
→ Routes to /update-context OR creates new
→ User reviews result
```

## Force New (skip check)

```bash
/create-context "topic" "content" --force-new
```

Use when:

- You KNOW it's a new topic
- Similar context exists but covers different angle
- Want to split a broad context into specific ones

## Configuration

```json
{
  "claudeContextus": {
    "contextCapture": {
      "similarityThreshold": 0.75, // When to consider "similar"
      "autoUpdateThreshold": 0.9, // When to auto-update without asking
      "checkSimilarity": true // Can disable to always create
    }
  }
}
```

## Example Workflows

### Workflow 1: Update Detected

```
User: "We switched from Jest to Vitest"
Claude: Context: propose: test-framework-change

/create-context "test-framework-change" "Switched from Jest to Vitest..."

→ Found: decisions/decision-use-jest.md (similarity: 0.93)
→ Routing to /update-context...
→ Opening editor with Jest context...
→ [You update "Jest" → "Vitest" throughout]
→ ✓ Updated decisions/decision-use-vitest.md
```

### Workflow 2: New Context

```
User: "New SDK pattern for encryption"
Claude: Context: propose: sdk-encryption-pattern

/create-context "sdk-encryption-pattern" "SDK users must encrypt passwords..."

→ Searching existing context files...
→ Best match: reference/reference-sdk-helper.md (similarity: 0.54)
→ Not similar enough, creating new context file
→ Created decisions/decision-sdk-password-encryption.md
→ ✓ Added to CONTEXT.md index
```

### Workflow 3: User Disambiguation

```
/create-context "error handling" "Use try-catch for API calls"

→ Found: gotchas/gotcha-error-logging.md (similarity: 0.79)
→ Similar, but not identical. What would you like to do?

[1] Update existing context (add API error handling section)
[2] Create new context (API-specific error handling)
[3] Show me the existing context first

→ [User picks 2]
→ Creating reference/reference-api-error-handling.md
```

## Related Skills

- `/update-context` - Directly update (if you know which one)
- `/audit-stale` - Find context files needing updates
- `/context-search` - Find similar context files manually
