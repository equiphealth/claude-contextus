---
name: context-merge
description: Merge duplicate patterns — LLM-assisted workflow to combine overlapping context files. Uses eval model (Haiku) to read both files, detect content overlap, and generate a unified version. Original kept, duplicate archived.
---

# context-merge

**Merge duplicates** — LLM-assisted deduplication of overlapping patterns.

## When to use

- After identifying duplicates via `/context-audit` or `/context-review`
- User asks to "merge duplicates" or "deduplicate context"
- Corpus cleanup to reduce noise

## Instructions

Conversational. Show candidates, preview merge, confirm before writing.

See [./reference.md](./reference.md) for:
- Merge algorithm and LLM prompting
- Conflict resolution
- Examples
