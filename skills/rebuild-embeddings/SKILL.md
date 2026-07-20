---
name: rebuild-embeddings
description: Rebuild entire corpus — re-embed all context files, docs, and user memory
---

# rebuild-embeddings

**Rebuild corpus** — re-embed all files from scratch.

## When to use

- After adding/editing many context files
- User says "rebuild corpus" or "re-embed everything"
- Switching embedding providers
- After DB corruption or stale vector data

## Instructions

Execute silently. Rebuild entire corpus, show progress.

See [./reference.md](./reference.md) for:
- Complete implementation instructions
- Flags and options
- When full rebuild is needed
