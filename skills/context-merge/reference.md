---
name: context-merge
description: Merge duplicate patterns — LLM-assisted workflow to combine overlapping context files. Uses eval model (Haiku) to read both files, detect content overlap, and generate a unified version. Original kept, duplicate archived.
---

# context-merge

**Merge duplicate patterns** — LLM-assisted workflow to combine overlapping context files.

## When to use

- Duplicate patterns detected (same topic, different files)
- Similar filenames flagged by `/context-doctor`
- Content overlap discovered during `/context-review`
- Manual deduplication after corpus growth

## How it works

1. Read both files
2. Call eval model (same as usage evaluation: Bedrock Haiku by default) with merge prompt
3. Present merged content to user for review/edit
4. On approval:
   - Write merged file (using first file's location)
   - Archive second file
   - Delete LanceDB rows for second file
   - Re-embed merged file
   - Stage all changes

## Instructions

When this skill is invoked:

```
/context-merge gotcha/gotcha-stale-closure.md gotcha/gotcha-closure-timing.md
```

**Steps:**

1. **Read both files** — Validate they exist, have proper frontmatter
2. **Detect overlap** — If files have < 20% content overlap, warn: "These don't look like duplicates. Continue anyway?"
3. **Call eval model** with merge prompt:

```
You are merging two overlapping context patterns into one.

File 1 (gotcha/gotcha-stale-closure.md):
---
name: stale-closure
description: React hooks with stale closure over state
metadata:
  type: gotcha
  tags: [react, hooks, state]
---
[body content...]

File 2 (gotcha/gotcha-closure-timing.md):
---
name: closure-timing
description: Async callbacks close over stale state in React
metadata:
  type: gotcha
  tags: [react, async, state]
---
[body content...]

Write a single merged context file that:
- Preserves all unique information from both
- Eliminates redundancy
- Uses frontmatter format: name, description, metadata.type, metadata.tags
- Keeps the body concise (under 500 words)
- Name should be descriptive (kebab-case slug)

Output ONLY the merged file content (frontmatter + body), nothing else.
```

4. **Parse response** — Extract frontmatter + body
5. **Present to user**:
   ```
   Merged pattern preview:
   
   Name: stale-closure
   Description: React hooks close over stale state in async callbacks
   Tags: react, hooks, state, async
   
   [body preview — first 200 chars]
   
   Accept? [yes/edit/cancel]
   ```

6. **On "edit"**: Open merged content in a code block, let user modify, then continue
7. **On "yes"**:
   - Write merged file to first file's location
   - Move second file to `.archive/`
   - Delete LanceDB rows for second file
   - Re-embed merged file (daemon auto-detects change)
   - Stage changes: `git add <merged-file>` + `git mv <second-file> .archive/`
8. **Report**:
   ```
   ✓ Merged gotcha-closure-timing.md into gotcha-stale-closure.md
   ✓ Archived gotcha/gotcha-closure-timing.md
   ✓ Re-embedding merged pattern (daemon handles this)
   
   Review with `git diff`, commit when ready.
   ```

## Merge Prompt Details

**Model:** Uses `usageEvaluation.provider` and `usageEvaluation.model` from config (default: Bedrock Haiku)

**Cost:** ~$0.0004 per merge (800 tokens input + 300 tokens output)

**Input:** Two full context files (frontmatter + body)

**Output:** Single merged file (frontmatter + body)

**Validation:** Verify output has valid frontmatter (name, description, metadata.type), else retry or fail gracefully

## Content Overlap Detection

Before merging, check if files actually overlap:

```typescript
function contentSimilarity(file1: string, file2: string): number {
  // Simple word overlap ratio (bag-of-words Jaccard)
  const words1 = new Set(file1.toLowerCase().split(/\s+/));
  const words2 = new Set(file2.toLowerCase().split(/\s+/));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}
```

If similarity < 0.2, warn user — files may not be duplicates.

## Arguments

**Required:**
- `<file1>` — First pattern file (kept, becomes merged file location)
- `<file2>` — Second pattern file (archived after merge)

**Optional:**
- `--force` — Skip overlap detection warning
- `--output <path>` — Write merged file to custom location (default: file1's path)
- `--no-archive` — Don't archive file2 (just write merged file)

## Example

```
User: /context-merge gotcha/gotcha-stale-closure.md gotcha/gotcha-closure-timing.md

Claude: Reading both files...

Overlap detected: 67% content similarity — these look like duplicates.

Calling merge model (Bedrock Haiku)...

Merged pattern preview:

Name: react-stale-closure
Description: React hooks and async callbacks can close over stale state
Tags: react, hooks, async, state, useEffect

[Preview shows merged body...]

Accept this merge? [yes/edit/cancel]

User: yes

Claude: ✓ Writing merged pattern to gotcha/gotcha-stale-closure.md
✓ Archiving gotcha/gotcha-closure-timing.md
✓ Staged changes

Review with `git diff`, commit when ready.
```

## Requirements

- Both files must exist and have valid frontmatter
- Eval model provider reachable (default: AWS Bedrock)
- Write access to `.claude/context/` and `.archive/`
- Git repo (for staging)

## Cost

~$0.0004 per merge (Bedrock Haiku estimate)

## Related Skills

- `/context-review` — Interactive curation (suggests merges)
- `/context-doctor` — Duplicate detection
- `/context-archive` — Archive one file instead of merging
- `/context-stats` — Identify similar patterns (co-occurrence data)
