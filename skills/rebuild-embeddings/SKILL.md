# Rebuild Embeddings

Regenerate all vector embeddings from context pattern files.

## When to Use

- After changing the embedding model
- After git merge conflict on the database
- After bulk updates to context files
- If embeddings become stale or corrupted
- When migrating between embedding providers

## What It Does

1. Scans all configured sources (project context, user context, docs, custom sources)
2. Reads each context file and document
3. Generates embeddings using the configured model
4. Stores embeddings in ChromaDB with metadata (content hash, mtime, model name)
5. Validates model consistency across the collection

## Usage

```bash
/rebuild-embeddings
```

### Options

```bash
/rebuild-embeddings --stale-only    # Only re-embed changed files
/rebuild-embeddings --force         # Rebuild even if up-to-date
/rebuild-embeddings --verbose       # Show progress per file
```

## Output

```
Rebuilding embeddings for project: automation
Embedding model: nomic-ai/nomic-embed-text-v1.5 (768 dim)

Sources:
✓ projectContext: 70 files
✓ projectDocs: 20 files
✓ userContext: 12 files
Total: 102 files

Embedding... [████████████████████] 102/102

✓ Complete
  - Embedded: 102 files
  - Skipped (unchanged): 0
  - Time: 18.4s
  - Database: ~/.contextus/data/automation/
```

## When to Rebuild

### Required

- **Model change**: Switching embedding models requires full rebuild (different vector spaces)
- **Database corruption**: If ChromaDB reports errors or missing data
- **Model validation failure**: When daemon detects model mismatch

### Recommended

- **After bulk edits**: If you've edited 10+ context files in one session
- **After merge**: If you pulled changes affecting many context patterns
- **Stale embeddings**: If `/context-debug` shows high stale percentage

### Optional

- **Before A/B testing**: Generate fresh baseline before comparing models
- **Periodic maintenance**: Monthly rebuild to ensure consistency

## Performance

At typical corpus scale (~100-200 files):

- **Full rebuild**: 15-30 seconds
- **Stale-only**: 2-5 seconds (depends on change count)
- **Model validation**: <100ms (metadata check only)

## Implementation Status

⏳ **Not yet implemented** — placeholder skill for design documentation.

When implemented, this skill will:

- Call `lib/embedder.ts` to generate embeddings
- Use `lib/context-loader.ts` to read source files
- Update ChromaDB via `lib/chroma-client.ts`
- Store embedding model name in collection metadata
- Validate model consistency on every rebuild
