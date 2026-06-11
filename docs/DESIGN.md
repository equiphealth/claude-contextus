# claude-contextus: Design & Implementation

_Last updated: June 10, 2026_

**Status**: Core scaffolding complete, implementation in progress

**Repository**: https://github.com/anthonypdawson/claude-contextus (private)

## Overview

This document describes how to implement automatic semantic retrieval for the `.claude/memory/` system using vector embeddings and Chroma. This upgrades manual index scanning to automatic, meaning-based memory injection.

**Important**: This is a **separate system** from claude-mem. Both use Chroma but serve different purposes:

| Feature | Manual claude-contextus (this doc) | claude-mem |
|---------|------------------------------|-----------|
| **Purpose** | Inject curated `.claude/memory/` patterns | Track tool use observations |
| **Source** | 64 hand-written markdown files | Auto-generated from PostToolUse hook |
| **Scope** | Normative rules/patterns | Historical activity log |
| **Chroma Mode** | File-based (`.claude/memory-db/`) | Server-based (`localhost:8000`) |
| **Version Control** | Committed with project | Stored in `~/.claude-mem/` |
| **Config** | `MEMORY_RAG_*` env vars | `CLAUDE_MEM_*` env vars |
| **Team Sharing** | Yes (git-tracked) | No (local per-user) |

## Current State (Manual)

**How it works now:**
1. `MEMORY.md` index loaded into context (~2-3k tokens)
2. Claude manually scans index to find relevant memories
3. Claude reads individual memory files on-demand
4. Relies on keyword matching in descriptions

**Limitations:**
- Manual discoverability requires scanning 88+ entries
- Limited to keyword matching in descriptions
- No synonym or semantic understanding
- Misses relevant memories if keywords don't align

## Proposed State (Automatic RAG)

**How it would work:**
1. All 64 memory files embedded into Chroma vector database
2. On every `UserPromptSubmit`, semantic search for top-k relevant memories
3. Inject top 3-5 memory contents directly into context
4. Dynamic relevance: only load what's needed for this specific prompt

**Benefits:**
- ✅ **Token efficient**: Load ~2-3k tokens instead of scanning 88-entry index
- ✅ **Semantic matching**: "How do I debug?" → matches Logger Helper memory
- ✅ **Synonym-aware**: "print", "log", "console" all match
- ✅ **Scales**: Can grow to 200+ memories without context pressure
- ✅ **Zero maintenance**: No manual keywords or tagging needed

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────┐
│                   UserPromptSubmit                      │
│                                                         │
│  1. User sends prompt                                   │
│  2. Embed prompt with same model as memories            │
│  3. Query Chroma for top-k similar memories             │
│  4. Inject memory contents into context                 │
│  5. Claude responds with relevant memory available      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Chroma Database                       │
│                                                         │
│  Collection: "claude-memory-automation"                 │
│    - 64 documents (one per memory file)                 │
│    - Metadata: file_path, category, type                │
│    - Embeddings: semantic representation                │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Embedding Pipeline                    │
│                                                         │
│  Initial: Embed all .claude/memory/**/*.md files        │
│  Incremental: Watch for file changes, re-embed          │
│  Model: Same as claude-mem observations                 │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
User: "How do I log errors in tests?"
   ↓
Embed prompt → [0.12, -0.43, 0.87, ...]
   ↓
Query Chroma (cosine similarity)
   ↓
Top matches:
  1. framework/feedback_use_logger_helper.md (0.92)
  2. testing/reference_test_session_artifacts.md (0.78)
  3. framework/feedback_identifying_crashes.md (0.71)
   ↓
Read top 3 memory files
   ↓
Inject into context before Claude responds
   ↓
Claude: "Use getLogger() from ~/helpers/logger..."
```

## Document Chunking Strategy

**Decision**: Chunk longer documents to avoid truncation. Standard memories are typically short enough to embed whole.

**Rationale**: The default embedding model (`all-MiniLM-L6-v2`) has a 256-token context window and silently truncates longer content. For docs and longer memories, chunking with overlap preserves semantic completeness. (Note: different models have different context windows — this will be tuned based on model benchmarking.)

**Chunking Parameters:**
- Chunk size: 512 tokens (2× model context to ensure full coverage after overlap)
- Overlap: 64 tokens (maintains context continuity across boundaries)
- Boundary preference: Split on markdown headers (`##`, `###`) when possible, fall back to token boundaries

**Chunk Metadata:**
```javascript
{
  id: "docs/DESIGN.md#chunk-3",
  document: "... chunk content ...",
  metadata: {
    parent_file: "docs/DESIGN.md",
    chunk_index: 2,           // 0-indexed
    chunk_total: 8,           // Total chunks for this file
    source: "projectDocs",
    type: "doc"
  }
}
```

**Retrieval Strategy: Inject Chunk + Breadcrumb**

When a chunk matches:
```markdown
### [Docs] DESIGN.md (chunk 3/8, similarity: 0.89)

> ## Daemon Architecture
> 
> The daemon pattern solves the model warm-up problem by keeping
> a persistent process that loads the embedding model once...

**Full document**: `docs/DESIGN.md` (245 tokens total)
```

**Benefits:**
- Compact injection (only matching chunk, not full parent doc)
- Breadcrumb gives Claude path to deep-dive with Read if needed
- Deduplication: if multiple chunks from same file match, consolidate under one breadcrumb

**Multiple Chunks from Same File:**
```markdown
### [Docs] DESIGN.md (3 matches, similarity: 0.89)

**Chunk 3/8**: Architecture section
> ... content ...

**Chunk 5/8**: Configuration section  
> ... content ...

**Chunk 7/8**: Examples section
> ... content ...

**Full document**: `docs/DESIGN.md`
```

**When NOT to Chunk:**
- Standard memory files (<500 tokens) — embed whole
- Short docs (<500 tokens) — embed whole
- Code snippets in memories — typically already excerpted

**Implementation Note**: Store relative path from project root in metadata (e.g., `docs/DESIGN.md`, not absolute path) so `formatMemoriesForInjection` can dedupe breadcrumbs across chunks and paths remain portable across machines.

## Embedding Providers

Contextus supports multiple embedding strategies with automatic fallback:

### Provider Hierarchy (Best → Fallback)

1. **Transformers.js** (Default, Recommended)
   - Pure JavaScript, runs in-process
   - No external dependencies or servers
   - Fast (~50-100ms per query after model load)
   - Works offline
   - Small footprint (~10-50MB cached models)
   - CPU-only is perfectly fine for <200 documents
   - **Default model**: `Xenova/all-MiniLM-L6-v2` (384 dim, 80MB, proven)
   - **Alternative**: `nomic-ai/nomic-embed-text-v1.5` (768 dim, 138MB, higher quality)
   
   ```typescript
   import { pipeline } from '@xenova/transformers';
   const embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
   const embedding = await embedder(text, { pooling: 'mean', normalize: true });
   ```

2. **Ollama** (Opt-in, Power Users)
   - Higher quality embeddings
   - Requires Ollama running locally
   - Slightly slower (~100-200ms per query)
   - User configures in settings
   
   ```typescript
   // User enables via config
   {
     "embedding": {
       "provider": "ollama",
       "model": "nomic-embed-text",
       "endpoint": "http://localhost:11434"
     }
   }
   ```

3. **Claude Semantic Matching** (Fallback)
   - No embeddings, uses Haiku sub-agent
   - Expands query → grep with synonyms → AI ranking
   - Slower (~2-5s) but always works
   - Useful if embedding models fail or quota exhausted
   
   ```typescript
   // Query expansion with Haiku
   "fixing flaky tests" → ["flaky", "intermittent", "unstable", "timing", "waitForExist"]
   // Grep + rank results by relevance
   ```

4. **Keyword Search** (Ultimate Fallback)
   - Plain grep if everything else fails
   - Fast but dumb
   - No semantic understanding

### Provider Selection Algorithm

```typescript
async function search(query: string): Promise<Result[]> {
  // Try vector search first (Transformers.js or Ollama)
  if (await hasVectorDB()) {
    const provider = config.embedding.provider || 'transformers';
    if (provider === 'transformers' && await transformersAvailable()) {
      return vectorSearch(query, 'transformers');
    }
    if (provider === 'ollama' && await ollamaAvailable()) {
      return vectorSearch(query, 'ollama');
    }
  }
  
  // Fall back to Claude semantic matching
  if (await claudeAvailable()) {
    return claudeSemanticSearch(query);
  }
  
  // Ultimate fallback: keyword grep
  return keywordSearch(query);
}
```

### Configuration

**Config schema**:
```json
{
  "embedding": {
    "provider": "transformers",  // "transformers" | "ollama" | "claude" | "keyword"
    "model": "Xenova/all-MiniLM-L6-v2",          // Default (384 dim, 80MB, proven)
    // Alternative: "nomic-ai/nomic-embed-text-v1.5" (768 dim, 138MB, higher quality)
    "ollama_model": "nomic-embed-text",          // If provider=ollama
    "ollama_endpoint": "http://localhost:11434",
    "dimensions": 384,  // Match your model: 384 for all-MiniLM, 768 for nomic
    "batchSize": 32
  },
  "search": {
    "enabled": true,
    "similarity_threshold": 0.7,
    "max_results": 10,
    "fallback_enabled": true  // Auto-fallback to Claude if embeddings fail
  }
}
```

### Storage: Chroma Vector Database

All providers store results in Chroma:

```typescript
// Structure:
.claude/memory/
├── .embeddings/
│   └── chroma_db/           // Chroma SQLite + index
│       ├── chroma.sqlite3
│       └── index/

// Chroma handles:
- Vector storage
- Cosine similarity search  
- Metadata (file path, hash, last_updated)
- Change detection (only re-embed if hash changed)

// Example:
chroma.add({
  id: "framework/feedback_use_lsp.md",
  embedding: [0.1, 0.2, ...],  // 384 or 768 dimensional (matches model)
  metadata: {
    hash: "abc123",
    category: "framework",
    type: "feedback",
    last_updated: "2026-06-10T15:00:00Z"
  }
});
```

### Performance Characteristics

| Provider | Initial Index | Query | Offline | Quality |
|----------|--------------|-------|---------|---------|
| Transformers.js | 20s (200 files) | 55ms | ✅ Yes | Good |
| Ollama | 30s (200 files) | 100ms | ✅ Yes* | Better |
| Claude Semantic | N/A | 2-5s | ❌ No | Good |
| Keyword | N/A | 10ms | ✅ Yes | Poor |

*Requires Ollama running locally

### Why CPU-Only is Fine

For `.claude/memory/` use case:
- **Small corpus**: 50-200 markdown files
- **One-time indexing**: ~20 seconds on first run
- **Cached forever**: Only re-embed changed files
- **Fast queries**: Single embedding (~50ms) + vector search (~5ms)

GPU only helps with 10,000+ documents or real-time re-indexing.

## Plugin vs Standalone Implementation

This memory RAG system can be implemented as either:

### Option A: Claude Plugin (Recommended)

**Why plugin:**
- ✅ **Reusable**: Install in any project with `.claude/memory/`
- ✅ **Self-contained**: Scripts, hooks, config bundled
- ✅ **Versioned**: `npm update claude-contextus-plugin`
- ✅ **Shareable**: Publish to community
- ✅ **Per-project**: Enable/disable in settings

**Plugin Structure:**
```
claude-contextus/
├── plugin.json                 # Metadata, version, dependencies
├── package.json                # Node dependencies (chromadb, transformers)
├── scripts/
│   ├── embed-memories.js       # Build/rebuild embeddings
│   ├── query-hook.js           # UserPromptSubmit semantic search
│   └── watch-memories.js       # Optional file watcher
├── hooks/
│   └── hooks.json              # Hook configuration
├── skills/
│   # RAG skills
│   ├── rebuild-embeddings/
│   │   └── SKILL.md            # /rebuild-embeddings
│   ├── memory-search/
│   │   └── SKILL.md            # /memory-search <query>
│   ├── memory-debug/
│   │   └── SKILL.md            # /memory-debug (stats)
│   # Management skills (from current system)
│   ├── create-memory/
│   │   └── SKILL.md            # /create-memory "topic" "context"
│   ├── create-doc/
│   │   └── SKILL.md            # /create-doc "topic" "context"
│   ├── add-patterns/
│   │   └── SKILL.md            # /add-patterns <file> "patterns"
│   ├── audit-memory/
│   │   └── SKILL.md            # /audit-memory (validation)
│   └── update-memory-index/
│       └── SKILL.md            # /update-memory-index (sync MEMORY.md)
├── lib/
│   ├── embedder.js             # Embedding logic
│   ├── chroma-client.js        # File-based Chroma access
│   ├── memory-loader.js        # Read .claude/memory/ files
│   ├── memory-creator.js       # Create memory files (used by /create-memory)
│   ├── memory-validator.js     # Validate frontmatter, structure
│   ├── deduplicator.js         # Check for duplicate memories
│   └── index-updater.js        # Update MEMORY.md index
├── templates/
│   ├── memory-template.md      # Template for new memories
│   └── doc-template.md         # Template for new docs
├── README.md
└── CHANGELOG.md
```

**Installation & Setup:**
```bash
# Install plugin (global or project-level)
claude plugin install claude-contextus

# Enable in project settings (.claude/settings.json)
{
  "enabledPlugins": {
    "claude-contextus": true
  },
  "memoryRag": {
    "enabled": true,
    "autoRebuild": true,
    "topK": 5,
    "similarityThreshold": 0.7
  }
}

# First use: builds embeddings automatically
# Or manually: /rebuild-embeddings
```

**Hooks Auto-Configured:**
The plugin's `hooks.json` adds:
```json
{
  "UserPromptSubmit": [
    {
      "hooks": [{
        "command": "node $PLUGIN_PATH/scripts/query-hook.js",
        "type": "command"
      }],
      "matcher": ".*"
    },
    {
      "hooks": [{
        "command": "node $PLUGIN_PATH/scripts/awareness-hook.js",
        "type": "command"
      }],
      "matcher": ".*"
    }
  ],
  "PostToolUse": [{
    "hooks": [{
      "command": "node $PLUGIN_PATH/scripts/watch-memories.js",
      "type": "command"
    }],
    "matcher": "Write|Edit"
  }]
}
```

**Hook Purposes:**

1. **Query Hook**: Semantic search + inject relevant memories (HTTP call to daemon)
2. **Awareness Hook**: Remind Claude to propose new memories proactively
3. **Watch Hook**: Auto-rebuild embeddings when memory files change (HTTP call to daemon)

**Important: Awareness Hook as Separate Script**

Instead of inline `echo` with complex JSON escaping (fragile across platforms), use a dedicated script:

```javascript
// scripts/awareness-hook.js
console.log(JSON.stringify({
  continue: true,
  hookSpecificOutput: {
    additionalContext: 
      "Memory awareness: Unless this response is purely trivial " +
      "(e.g. a one-line answer, yes/no, or acknowledgment), append footer: " +
      "Memory: propose: topic-name if ANY new pattern, detail, or context " +
      "was discussed. Omit only if truly nothing reusable was covered."
  }
}));
```

This avoids shell quote escaping issues entirely and works identically on Windows/Unix/macOS.

### Option B: Standalone Scripts

**Why standalone:**
- ✅ **Simple**: Just scripts, no plugin system
- ✅ **Customizable**: Easier to modify for specific needs
- ✅ **Learning**: See how it works without abstraction

**Structure:**
```
.claude/
├── scripts/
│   ├── embed-memories.js
│   └── query-memories.js
└── hooks/
    └── claude-contextus-hooks.json
```

**Trade-off:** No auto-updates, harder to share across projects.

---

## Plugin Implementation Details

### plugin.json

```json
{
  "name": "claude-contextus",
  "version": "1.0.0",
  "description": "Complete memory management: markdown-based storage + automatic semantic retrieval via vector embeddings",
  "author": "Anthony Dawson",
  "repository": "github:yourusername/claude-contextus-plugin",
  "license": "MIT",
  "engines": {
    "claude": ">=1.0.0",
    "node": ">=18.0.0"
  },
  "dependencies": {
    "chromadb": "^1.8.0",
    "@xenova/transformers": "^2.6.0"
  },
  "config": {
    "enabled": true,
    "chroma": {
      "mode": "file",
      "path": ".claude/memory-db"
    },
    "embedding": {
      "provider": "transformers",
      "model": "Xenova/all-MiniLM-L6-v2",  // Default: fast, proven, 80MB
      // Alternative: "nomic-ai/nomic-embed-text-v1.5" for higher quality (768 dim, 138MB)
      "ollama_model": "nomic-embed-text",
      "dimensions": 384,  // 768 if using nomic
      "batchSize": 32
    },
    "retrieval": {
      "topK": 5,
      "similarityThreshold": 0.7,
      "maxTokens": 3000
    },
    "autoRebuild": true
  },
  "hooks": "hooks/hooks.json",
  "skills": [
    "skills/rebuild-embeddings",
    "skills/memory-search",
    "skills/memory-debug",
    "skills/create-memory",
    "skills/create-doc",
    "skills/add-patterns",
    "skills/audit-memory",
    "skills/update-memory-index"
  ]
}
```

### Skills

**`/rebuild-embeddings`**
```markdown
# Rebuild Memory Embeddings

Regenerates all embeddings from `.claude/memory/*.md` files.

## When to Use
- After git merge conflict on `.claude/memory-db/`
- After changing embedding model
- After bulk memory file updates
- If embeddings are stale or corrupted

## Usage
```bash
/rebuild-embeddings
```

## Options
```bash
/rebuild-embeddings --force      # Rebuild even if up-to-date
/rebuild-embeddings --verbose    # Show progress per file
```

## Output
- Number of memories embedded
- Time taken
- ChromaDB collection stats
```

**`/memory-search <query>`**
```markdown
# Manual Memory Search

Semantic search across `.claude/memory/` without automatic injection.

## When to Use
- Debugging retrieval quality
- Finding relevant memories manually
- Testing similarity thresholds

## Usage
```bash
/memory-search "How do I debug test failures?"
```

## Output
- Top-k matches with similarity scores
- File paths and excerpts
- Suggestion to adjust threshold if needed
```

**`/memory-debug`**
```markdown
# claude-contextus Debugging

Shows detailed stats about embeddings and retrieval quality.

## Usage
```bash
/memory-debug
```

## Output
- Total memories embedded
- Embedding model used
- ChromaDB collection size
- Recent query stats (avg similarity, token usage)
- Suggestions for tuning topK/threshold
```

### Scripts

**`scripts/embed-memories.js`**
```javascript
// High-level pseudocode
const { ChromaClient } = require('chromadb');
const { pipeline } = require('@xenova/transformers');

async function embedMemories({ rebuild = false, verbose = false }) {
  // 1. Initialize file-based Chroma
  const client = new ChromaClient({ path: '.claude/memory-db' });
  const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';  // From config
  const collection = await client.getOrCreateCollection('manual-memory', {
    metadata: {
      embeddingModel: EMBEDDING_MODEL,  // Store model name for validation
      createdAt: new Date().toISOString()
    }
  });
  
  // Validate embedding model matches
  const collectionMeta = await collection.metadata();
  if (collectionMeta.embeddingModel && collectionMeta.embeddingModel !== EMBEDDING_MODEL) {
    throw new Error(
      `Collection was built with ${collectionMeta.embeddingModel}, ` +
      `but current config specifies ${EMBEDDING_MODEL}. ` +
      `Run /rebuild-embeddings to regenerate.`
    );
  }
  
  // 2. Find all memory files
  const memoryFiles = glob.sync('.claude/memory/**/*.md', {
    ignore: ['**/MEMORY.md', '**/README.md']
  });
  
  // 3. Check if rebuild needed
  if (!rebuild) {
    const needsUpdate = await checkIfStale(collection, memoryFiles);
    if (!needsUpdate) {
      console.log('Embeddings up-to-date');
      return;
    }
  }
  
  // 4. Load embedding model (local, no API keys)
  const embedder = await pipeline('feature-extraction', 
    'Xenova/all-MiniLM-L6-v2');
  
  // 5. Batch embed
  for (const file of memoryFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const embedding = await embedder(content, { 
      pooling: 'mean', 
      normalize: true 
    });
    
    await collection.upsert({
      ids: [file],
      embeddings: [Array.from(embedding.data)],
      documents: [content],
      metadatas: [{
        path: file,
        mtime: fs.statSync(file).mtimeMs,
        category: extractCategory(file)
      }]
    });
    
    if (verbose) console.log(`✓ ${file}`);
  }
  
  console.log(`Embedded ${memoryFiles.length} memories`);
}
```

**`scripts/query-hook.js`**
```javascript
// Receives UserPromptSubmit event, returns memory injection

async function queryHook(userPrompt) {
  // 1. Load config
  const config = loadConfig('.claude/settings.json');
  if (!config.memoryRag?.enabled) return { continue: true };
  
  // 2. Embed user prompt
  const embedder = await getEmbedder();
  const queryEmbedding = await embedder(userPrompt);
  
  // 3. Query Chroma
  const client = new ChromaClient({ path: '.claude/memory-db' });
  const collection = await client.getCollection('manual-memory');
  const results = await collection.query({
    queryEmbeddings: [Array.from(queryEmbedding.data)],
    nResults: config.memoryRag.topK
  });
  
  // 4. Filter by threshold
  // Note: Chroma returns results as parallel arrays (ids, documents, metadatas, distances)
  const relevant = results.distances[0]
    .map((dist, i) => ({
      id: results.ids[0][i],
      document: results.documents[0][i],
      metadata: results.metadatas[0][i],
      similarity: 1 - dist  // cosine distance → similarity
    }))
    .filter(r => r.similarity >= config.memoryRag.similarityThreshold);
  
  // 5. Format injection
  if (relevant.length === 0) return { continue: true };
  
  const context = formatMemoriesForInjection(relevant);
  
  return {
    continue: true,
    hookSpecificOutput: {
      additionalContext: context
    }
  };
}

function formatMemoriesForInjection(memories) {
  const header = `# Relevant Memories (${memories.length} matched)\n\n`;
  const entries = memories.map(m => 
    `## ${m.metadata.category} - ${path.basename(m.id, '.md')}\n` +
    `Similarity: ${m.similarity.toFixed(2)}\n\n` +
    `${m.document}\n\n` +
    `---\n`
  ).join('\n');
  
  return header + entries;
}
```

### Migration Path

**Phase 1: Develop Standalone** (Week 1-2)
1. Create scripts in `.claude/scripts/`
2. Test embedding + query pipeline
3. Tune thresholds, validate quality
4. Document findings

**Phase 2: Package as Plugin** (Week 3)
1. Create plugin structure
2. Move scripts to plugin
3. Add skills (`/rebuild-embeddings`, etc.)
4. Write plugin README

**Phase 3: Test in Project** (Week 4)
1. Install plugin locally: `claude plugin install ./claude-contextus`
2. Verify hooks work
3. Compare with standalone version
4. Collect usage metrics

**Phase 4: Publish** (Optional)
1. Publish to npm: `npm publish claude-contextus`
2. Submit to Claude plugin registry
3. Document for community

---

## Implementation Plan

### Phase 1: Embedding Pipeline

**Goal**: Populate Chroma with all memory embeddings

```bash
# Script: ~/.claude/scripts/embed-memories.js
# 1. Find all .claude/memory/**/*.md files (exclude MEMORY.md, README.md)
# 2. For each file:
#    - Read content
#    - Extract frontmatter (name, description, type)
#    - Generate embedding (use same model as claude-mem)
#    - Store in Chroma collection "claude-memory-{project}"
# 3. Store metadata: file_path, category, type, last_modified
```

**Key decisions:**
- Use same embedding model as claude-mem observations (consistency)
- Collection per project (isolation: automation vs other projects)
- Store full file content as document (not just description)
- Metadata includes category from MEMORY.md for debugging

### Phase 2: Daemon + HTTP Architecture

**Decision**: Use persistent daemon with HTTP API instead of stateless hooks.

**Rationale**: `@xenova/transformers` model loading takes 2-5 seconds due to WASM initialization — far exceeding the <100ms latency target. A fresh Node process per hook invocation makes this unavoidable.

**Architecture:**

```
SessionStart hook
  → ensure daemon is running (start if not)
  → daemon loads embedding model, initializes Chroma client

UserPromptSubmit hook (thin HTTP client)
  → POST { prompt } to localhost:PORT/query
  → return { additionalContext: ... } from response

PostToolUse hook (Write|Edit, thin HTTP client)  
  → POST { file, content } to localhost:PORT/notify
  → daemon triggers incremental re-embed if memory file changed
```

**Benefits:**
- ✅ Model loaded once per session, warm for all subsequent queries
- ✅ Chroma client lifecycle owned by daemon (connection pooling, caching)
- ✅ HTTP boundary = clean versioning separation between hook format and daemon logic
- ✅ Hooks become dumb thin clients — resilient to Claude Code hook API changes
- ✅ Daemon can be curled directly during development for retrieval testing

**Daemon Responsibilities:**
- Model loading and warm-up
- Chroma client and collection management
- Query execution (embed → search → filter → format)
- Incremental re-embed on file change notifications
- Session state tracking
- Source management (project, user, custom sources)

**Hook Responsibilities:**
- Serialize event JSON
- POST to daemon
- Return daemon response to Claude Code

**SessionStart Hook:**
```bash
# Check if daemon running, start if not
if ! curl -sf http://localhost:PORT/health > /dev/null; then
  node $PLUGIN_PATH/daemon/server.js &
  sleep 1  # brief warm-up
fi
```

**Validated by**: The `claude-recall` plugin already uses this pattern — auto-starting a worker service on `SessionStart`.

### Daemon Lifecycle Management

**Daemon Shutdown:**

Options for when to kill the daemon:

1. **Keep warm between sessions (Recommended)**
   - Daemon stays alive until explicitly killed or machine restart
   - Best latency: next session has warm model immediately
   - Small memory footprint (~100-200MB)
   - Auto-cleanup: kill stale daemons on SessionStart if PID file exists but process is dead

2. **Kill on SessionEnd**
   - Clean shutdown when Claude session ends
   - Frees memory between sessions
   - Adds 2-5s latency to every session start
   - Hook: `SessionEnd` → `POST /shutdown` to daemon

3. **TTL-based (Hybrid)**
   - Daemon shuts down after N minutes of inactivity
   - Balances memory vs latency
   - Daemon tracks last query timestamp, auto-exits after TTL

**Recommendation**: Start with option 1 (keep warm) — simpler, better UX. Add TTL later if users complain about memory.

### Multiple Session Handling

**Question**: One daemon per session, or shared daemon across sessions/projects?

**Options:**

#### Option A: Single Shared Daemon (Recommended)

**One daemon for all Claude sessions, all projects.**

**Rationale:**
- ✅ Model loaded once (~100-200MB), shared across everything
- ✅ Simplest: one port, one PID, one daemon to manage
- ✅ First Claude session (any project) pays startup cost, all others instant
- ✅ Project isolation via request parameter, not process isolation
- ✅ No port conflicts or allocation logic needed

**Architecture:**

```
~/.claude/contextus/
  data/
    automation/          # Project A DB
    backend/             # Project B DB
  runtime/
    daemon.pid          # Single daemon PID
    daemon.port         # Fixed port (e.g., 37800)
```

**API Contract:**
```javascript
// Request includes project context
POST http://localhost:37800/query
{
  "project": "automation",  // Which DB to query
  "prompt": "How do I debug tests?"
}

// Daemon routes to correct ChromaDB
const dbPath = `~/.claude/contextus/data/${req.body.project}/`;
const client = new ChromaClient({ path: dbPath });
// ... query and return
```

**Session Lifecycle:**

```
Session 1 starts in automation/
  → ensureDaemonRunning() checks ~/.claude/contextus/runtime/daemon.pid
  → Daemon not running, starts it on fixed port 37800
  → Daemon loads model, ready

Session 2 starts in automation/ (concurrent)
  → ensureDaemonRunning() checks daemon.pid
  → Daemon running, health check passes
  → Shares daemon (instant)

Session 3 starts in backend/ (different project)
  → ensureDaemonRunning() checks daemon.pid
  → Daemon running, health check passes
  → Shares daemon, query specifies project: "backend"
  → Daemon opens/caches backend DB, routes correctly
```

**Benefits:**
- Maximum efficiency: one model, shared everywhere
- Simplest port management (fixed port)
- Zero cross-contamination if API is clean (project param required)
- Daemon stays warm across all work

**Trade-offs:**
- Single point of failure (crash affects all sessions)
- Port 37800 must be available
- Slightly larger memory footprint if caching multiple project DBs

---

#### Option B: One Daemon Per Project

**Separate daemon for each project.**

**Rationale:**
- ✅ Project isolation via separate processes
- ✅ Crash in one project doesn't affect others
- ✅ Can tune memory/resources per project

**Architecture:**

```
~/.claude/contextus/runtime/
  automation.pid       # Daemon for automation
  automation.port      # Port 37801
  backend.pid          # Daemon for backend
  backend.port         # Port 37802
```

**Benefits:**
- Process-level isolation
- Independent daemon lifecycle per project
- Crash blast radius limited to one project

**Trade-offs:**
- More complex port management
- Multiple model instances (~100-200MB each)
- Multiple daemons to monitor/clean up
- Slower: each project pays first-session startup cost

---

**Recommendation: Option A (Single Shared Daemon)**

Start with the simplest model. Contamination isn't a risk if the API requires `project` parameter — isolation is enforced at the query level, not the process level. The memory savings and simplicity are worth it.

**Critical Constraint: Embedding Model Must Be Consistent**

A shared daemon only works if all projects use the **same embedding model**. Different models produce incompatible embedding spaces — you can't embed with `all-MiniLM-L6-v2` and query a DB built with `nomic-embed-text`.

**Strategy:**
1. **Global default model** (recommended): Set one embedding model in `~/.claude/contextus/config.json`, used by all projects
2. **Validate on startup**: Daemon checks each project DB's metadata for model mismatch
3. **Fail fast**: If project DB was built with different model, return error + instructions to rebuild

```javascript
// Daemon validates model compatibility
async function validateProjectDB(projectName: string): Promise<void> {
  const dbPath = `~/.claude/contextus/data/${projectName}/`;
  const collection = await chromaClient.getCollection('contextus');
  const metadata = await collection.metadata();
  
  if (metadata.embeddingModel !== DAEMON_MODEL) {
    throw new Error(
      `Project '${projectName}' was built with ${metadata.embeddingModel}, ` +
      `but daemon is running ${DAEMON_MODEL}. ` +
      `Run /rebuild-embeddings to regenerate with current model.`
    );
  }
}
```

**Per-Project Model Override (forces Option B):**

If a user explicitly configures a different model for a specific project:

```json
// automation/.claude/settings.json
{
  "embedding": {
    "model": "nomic-embed-text"  // Different from global default
  }
}
```

Daemon startup logic:
```javascript
if (projectHasCustomEmbeddingModel(projectName)) {
  // Fall back to per-project daemon
  console.log('Project uses custom embedding model, launching dedicated daemon');
  return launchPerProjectDaemon(projectName);
}
```

**Migration path**: If users hit issues (model conflicts, port conflicts, want per-project isolation), add config flag:

```json
{
  "daemon": {
    "mode": "shared"  // or "per-project"
  }
}
```

**Default**: Shared daemon with global model (simplest, covers 95% of users).

**Crash Recovery:**

**Key insight**: `SessionStart` fires once at session start, not on every prompt. If the daemon crashes mid-session, the `UserPromptSubmit` hook must handle recovery.

**Strategy: Fire-and-Forget Restart**

```javascript
// Shared utility: lib/ensure-daemon.js
async function ensureDaemonRunning(): Promise<boolean> {
  // Check PID file
  if (fs.existsSync(PID_PATH)) {
    const pid = fs.readFileSync(PID_PATH, 'utf8');
    if (processExists(pid)) {
      // Check health endpoint
      try {
        const response = await fetch('http://localhost:PORT/health', { timeout: 1000 });
        if (response.ok) return true;  // Daemon healthy
      } catch (err) {
        // PID exists but health check failed — clean up
        try { process.kill(pid, 0); } catch { /* ignore */ }
      }
    }
    // Stale PID file
    fs.unlinkSync(PID_PATH);
  }
  
  // Start daemon
  spawn('node', [DAEMON_PATH], {
    detached: true,
    stdio: 'ignore'
  }).unref();
  
  return false;  // Started but not yet warm
}

// UserPromptSubmit hook
async function queryHook(prompt: string) {
  try {
    const response = await fetch('http://localhost:PORT/query', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
      timeout: 5000
    });
    return await response.json();
  } catch (err) {
    // Daemon unreachable — restart in background, proceed without context
    ensureDaemonRunning();  // Fire-and-forget
    
    return { continue: true };  // Graceful degradation
  }
}

// SessionStart hook
async function sessionStartHook() {
  const wasRunning = await ensureDaemonRunning();
  if (!wasRunning) {
    // Wait briefly for model warm-up
    await sleep(2000);
  }
  return { continue: true };
}
```

**Recovery Behavior:**
- Daemon crash costs **one missed injection** (the current prompt)
- Daemon restarts in background (fire-and-forget)
- Next prompt gets full context again (~2-5s after restart)
- Session never blocks or fails

**Graceful Degradation:**
- Hook timeout → empty context (Claude proceeds without RAG)
- Daemon crash → trigger restart, proceed without context
- Never block the user's prompt from reaching Claude
- Claude falls back to manual memory scanning if needed

**PID File Management:**
```bash
# Daemon writes PID on startup
echo $$ > ~/.claude/contextus/daemon.pid

# SessionStart checks health
if [ -f ~/.claude/contextus/daemon.pid ]; then
  PID=$(cat ~/.claude/contextus/daemon.pid)
  if ! ps -p $PID > /dev/null; then
    # Stale PID file, clean up
    rm ~/.claude/contextus/daemon.pid
  fi
fi

# Start if not running
if ! curl -sf http://localhost:PORT/health > /dev/null; then
  node $PLUGIN_PATH/daemon/server.js &
fi
```

**Health Endpoint:**
```javascript
// Daemon health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    modelLoaded: embedder !== null,
    chromaConnected: await chromaClient.heartbeat()
  });
});
```

### Phase 3: Incremental Updates

**Goal**: Keep embeddings fresh as memories change

**Options:**

**A. File watcher** (real-time):
```bash
# Watch .claude/memory/ for changes
# On file change: re-embed and update Chroma
# Requires: chokidar or native fs.watch
```

**B. Lazy update** (on-demand):
```bash
# Store last_modified in Chroma metadata
# On query: check file mtimes, re-embed if stale
# Trade-off: First query after change pays update cost
```

**C. Hook-based** (on memory creation):
```bash
# PostToolUse hook on Write/Edit to .claude/memory/
# Trigger re-embedding for affected file
# Cleanest integration with existing workflow
```

**Recommendation**: Start with **B (lazy)**, upgrade to **C (hook-based)** if performance matters.

### Phase 4: Debugging & Tuning

**Goal**: Visualize and optimize retrieval quality

**Tools:**
- `vector-inspector` app to visualize embeddings
- Similarity threshold tuning (0.6? 0.7? 0.8?)
- Top-k tuning (3? 5? 10?)
- False positive analysis (irrelevant memories retrieved)
- False negative analysis (relevant memories missed)

**Debug queries:**
```bash
# What memories are closest to this prompt?
curl -X POST http://localhost:8000/query \
  -d '{"text": "How do I log errors?", "n_results": 10}'

# Visualize embedding clusters
vector-inspector http://localhost:8000 claude-memory-automation
```

**Metrics to track:**
- Query latency (target: <100ms)
- Retrieval precision (relevant / retrieved)
- Retrieval recall (relevant retrieved / all relevant)
- Token usage (should decrease significantly)

## Configuration

### Environment Variables

**Critical**: Use dedicated `MEMORY_RAG_*` variables, **not** claude-mem's `CLAUDE_MEM_*` variables. These are separate systems with different needs.

```bash
# claude-contextus settings (independent from claude-mem)
MEMORY_RAG_ENABLED=true
MEMORY_RAG_CHROMA_MODE=file                         # file-based, not server
MEMORY_RAG_CHROMA_PATH=.claude/memory-db            # Project-relative path
MEMORY_RAG_COLLECTION_NAME=manual-memory-automation # Per-project collection
MEMORY_RAG_TOP_K=5                                  # Return top 5 matches
MEMORY_RAG_SIMILARITY_THRESHOLD=0.7                 # Min similarity score
MEMORY_RAG_EMBEDDING_MODEL=text-embedding-3-small   # OpenAI or local model
MEMORY_RAG_AUTO_REBUILD=true                        # Rebuild on memory file changes
```

**Why separate config:**
- ✅ Independence: claude-contextus works even if claude-mem disabled
- ✅ Different modes: File-based vs server-based Chroma
- ✅ Clear ownership: No confusion about which system uses which setting
- ✅ Tuning flexibility: Can optimize each system separately

### Per-Project Settings

In `.claude/settings.json` (project-level):
```json
{
  "memoryRag": {
    "enabled": true,
    "collectionName": "claude-memory-automation",
    "topK": 5,
    "similarityThreshold": 0.7
  }
}
```

## Migration Strategy

### Phase 1: Embed & Test (Manual)
1. Run embedding script to populate Chroma
2. Test queries manually via `curl` or Python script
3. Validate retrieval quality with known queries
4. Tune thresholds and top-k

### Phase 2: Hook Integration (Passive)
1. Add hook that runs semantic search
2. Hook logs matched memories but doesn't inject
3. Review logs to validate quality in real usage
4. Compare manual memory selection vs automatic

### Phase 3: Active Injection
1. Switch hook to inject memories into context
2. Monitor token usage (should decrease)
3. Track false positives/negatives
4. Iterate on thresholds

### Phase 4: Deprecate Manual Index
1. Once confident in automatic retrieval
2. Remove MEMORY.md from auto-load
3. Keep MEMORY.md as human-readable index only
4. Fallback: manual `/memory-search` skill if needed

## Git Integration & Storage

### ChromaDB Storage Location

**Decision**: ChromaDB files are stored in `~/.claude/contextus/data/{project}/` (per-user, per-project), **NOT** committed to git.

**Rationale**: 
- ✅ Avoids binary SQLite merge conflicts entirely
- ✅ Keeps project directories clean (only source `.md` files in git)
- ✅ Per-user configuration (custom sources don't conflict with teammates)
- ✅ Derived artifacts belong in user space, not version control

**Structure:**
```
# In project (git-tracked)
.claude/
├── memory/              # Committed: source memory files
│   ├── MEMORY.md
│   ├── sdk/
│   ├── testing/
│   └── framework/
└── settings.json        # Gitignored: personal config

# In user space (not in git)
~/.claude/contextus/data/
└── {project-name}/      # Per-project ChromaDB instance
    ├── chroma.sqlite3
    └── index/
```

### Initial Setup

On first session in a project:
```bash
cd automation
# First prompt triggers auto-build
→ Building ~/.claude/contextus/data/automation/
→ Indexing 151 files (64 project + 87 parent + user)
→ ✓ Ready! (~15-20 seconds)
```

**No manual setup required** — embeddings build automatically from source files.

### Handling Changes

When memory files change:
```bash
# File watcher (PostToolUse hook) detects change
vim .claude/memory/testing/feedback_new.md

→ Incremental re-embed: ~/.claude/contextus/data/automation/
→ ✓ Updated (2-3 seconds)
```

**Note on git-committed DB section in original design**: This approach has been **superseded** by the user-space model. See [DESIGN ADDENDUM.md](./DESIGN%20ADDENDUM.md) §1 for details.

### Rebuild Script

**Purpose**: Regenerate all embeddings from scratch

```bash
# package.json
{
  "scripts": {
    "rebuild-memory-embeddings": "node scripts/embed-memories.js --rebuild"
  }
}
```

**When to run:**
- After git merge conflict on ChromaDB
- After changing embedding model
- After bulk memory file updates
- If embeddings become stale/corrupted

**Performance**: ~5-10 seconds for 64 files

## Edge Cases & Considerations

### Multi-Project Memories

**Problem**: Global `.claude/memory/` used across all projects

**Solution**: 
- One ChromaDB file per project (`.claude/memory-db/` in each project)
- Collection name includes project: `manual-memory-automation`
- Global memories can be symlinked or imported if needed

### Memory Updates

**Problem**: Edited memory has stale embedding

**Solutions**:
1. Lazy: Check `last_modified`, re-embed if stale (adds ~50ms per query)
2. Eager: PostToolUse hook re-embeds on Write/Edit to memory files
3. Hybrid: Track dirty flag, re-embed batch on SessionStart

### Cold Start

**Problem**: First query after embedding pipeline slow

**Solution**:
- Pre-warm embeddings on SessionStart (load collection into memory)
- Or accept first-query penalty (~200ms) for simplicity

### Chroma Unavailable

**Problem**: Chroma server not running

**Fallback**:
- Hook fails gracefully, returns empty results
- Claude falls back to manual MEMORY.md scanning
- Log warning for user to start Chroma

### Irrelevant Memories

**Problem**: Low-quality matches injected (similarity >threshold but not useful)

**Solutions**:
1. Raise similarity threshold (0.7 → 0.8)
2. Lower top-k (5 → 3)
3. Add negative sampling (exclude certain categories)
4. User feedback: track which injected memories are actually used

## Performance Targets

- **Query latency**: <100ms (embed + search + read files)
- **Embedding time**: <10ms per memory (batch initial embed: ~5 seconds for 64 files)
- **Token savings**: 15-30k (full load) → 2-5k (top 3-5 memories)
- **Retrieval accuracy**: >80% precision, >70% recall (manual validation)

## Alternatives Considered

### 1. Keyword Tags (Rejected)

**Approach**: Add 7-10 keywords per memory, match on keywords

**Why rejected**:
- ❌ High maintenance (manual curation per memory)
- ❌ Rigid matching (no synonyms)
- ❌ Limited coverage (novel queries fail)
- ❌ Doesn't scale (keyword explosion)

### 2. Full-Text Search (Rejected)

**Approach**: Elasticsearch/PostgreSQL FTS on memory content

**Why rejected**:
- ❌ Keyword-based, not semantic
- ❌ Requires exact term matches
- ❌ No understanding of meaning
- ✅ Could be fallback for exact matches

### 3. LLM-based Retrieval (Overkill)

**Approach**: Use LLM to score relevance of each memory

**Why rejected**:
- ❌ Expensive (64 LLM calls per query)
- ❌ Slow (seconds instead of milliseconds)
- ❌ Overkill when embeddings work
- ✅ Could be used for re-ranking top candidates

## Success Metrics

**Quantitative:**
- Token usage decrease: >50% reduction in memory-related tokens
- Query latency: <100ms p95
- Retrieval precision: >80% (manual spot-checks)

**Qualitative:**
- Fewer "let me check the memory" prompts
- More accurate memory application
- No user complaints about irrelevant injections
- User doesn't need to explain what memory to check

## Next Steps

1. **Prototype embedding pipeline** (1-2 hours)
   - Script to embed all memories into Chroma
   - Validate with manual queries
   
2. **Build query hook** (2-3 hours)
   - UserPromptSubmit hook
   - Semantic search + injection
   - Logging for debugging

3. **Test with real sessions** (1 week)
   - Monitor quality
   - Tune thresholds
   - Collect metrics

4. **Iterate based on data** (ongoing)
   - Adjust top-k and thresholds
   - Add negative sampling if needed
   - Consider re-ranking if quality issues

## Architectural Refinements

Based on design review feedback, these refinements should be prioritized during implementation:

### 1. Source-Aware Weighting

**Problem**: With multiple memory sources (local project, parent repo, user memory), parent/global patterns can drown out local nuance.

**Solution**: Add source field to Chroma metadata and apply weighting:

```typescript
// Scoring hierarchy
const sourceWeights = {
  'projectMemory': 1.0,    // Local patterns (highest priority)
  'projectDocs': 0.9,      // Local documentation
  'parentMemory': 0.7,     // Parent repo patterns
  'userMemory': 0.8,       // Personal notes
  'userDocs': 0.7          // Personal documentation
};

// Apply during retrieval
const weightedScore = cosineSimilarity * sourceWeights[doc.metadata.source];
```

**Benefits**:
- Local patterns get priority
- Parent patterns don't overshadow project-specific knowledge
- Explicit in `/memory-debug` output

### 2. Thin Re-Ranking Layer

**Problem**: Pure cosine similarity doesn't account for memory type, recency, or usage patterns.

**Solution**: Lightweight post-retrieval scoring using frontmatter metadata:

```typescript
function rerank(results: SearchResult[]): SearchResult[] {
  return results.map(r => ({
    ...r,
    finalScore: r.similarity 
      * sourceWeight(r.source)
      * typeBoost(r.metadata.type)      // feedback > reference > decision
      * freshnessDecay(r.metadata.updated)  // slight penalty for old
      * usageBoost(r.metadata.accessCount)  // optional: boost frequently used
  })).sort((a, b) => b.finalScore - a.finalScore);
}

const typeBoosts = {
  'feedback': 1.2,    // Actionable patterns get priority
  'reference': 1.0,   // Neutral
  'decision': 0.9,    // Context, less immediately actionable
  'project': 0.8      // Status updates
};
```

**Avoids**:
- Full LLM re-ranking (expensive)
- Complex ML models (overkill for <200 docs)

**Keeps**:
- Fast (<5ms overhead)
- Cheap (no API calls)
- Tunable (config-driven weights)

### 3. Formalize Staleness Handling

**Problem**: Embedding freshness is implicit, hard to debug, and inconsistently handled.

**Solution**: Make staleness a first-class health metric:

```typescript
interface EmbeddingMetadata {
  contentHash: string;        // SHA-256 of file content
  lastEmbedded: string;       // ISO timestamp
  fileModified: string;       // File mtime
  isStale: boolean;          // Computed: hash mismatch or mtime > lastEmbedded
}

// Health check command
async function auditStaleness(): Promise<StaleReport> {
  const allDocs = await chroma.collection.get();
  const stale = allDocs.filter(doc => {
    const currentHash = hashFile(doc.metadata.filePath);
    return currentHash !== doc.metadata.contentHash;
  });
  
  return {
    total: allDocs.length,
    stale: stale.length,
    files: stale.map(d => d.metadata.filePath)
  };
}
```

**Expose in `/memory-debug`**:
```
Memory Health:
  Total embeddings: 64
  Stale embeddings: 3 (4.7%)
  Files needing re-embed:
    - .claude/memory/testing/feedback_new_pattern.md
    - .claude/memory/framework/reference_updated.md
```

**Repair strategies**:
- On-demand: detect during query, re-embed before returning results
- Batch: `/rebuild-embeddings --stale-only`
- Automatic: PostToolUse hook on Write/Edit to memory files

### 4. Standardize Injection Format

**Problem**: Injected memory format is inconsistent, hard to parse, and doesn't scale to many results.

**Solution**: Define a Memory Block schema:

```markdown
## 📝 Relevant Memories (3 found)

### [Framework] Use Logger Helper (similarity: 0.92)
**Source**: `.claude/memory/framework/feedback_use_logger_helper.md`  
**Type**: feedback | **Updated**: 2026-05-15

> Always use `getLogger()` from `~/helpers/logger` instead of `console.log`.
> This ensures consistent log formatting and makes it easy to filter logs...

[Full content available - 245 tokens]

---

### [Testing] Test Session Artifacts (similarity: 0.78)
**Source**: `.claude/memory/testing/reference_test_session_artifacts.md`  
**Type**: reference | **Updated**: 2026-04-20

> Session artifacts are stored in `results/sessions/{sessionId}/`...

---

_Memory retrieval: 55ms | Injected: 1,240 tokens | Sources: projectMemory(2), userMemory(1)_
```

**Benefits**:
- Structured, scannable format
- Shows similarity scores (helps debug retrieval quality)
- Source attribution (know where knowledge comes from)
- Token count (helps manage context budget)
- Excerpt mode when context is tight

**Future**: Allow Claude to request "excerpt only" mode when approaching context limits.

## References

- [Global Memory System](global-memory.md) — Current manual system
- [claude-mem Chroma Integration](~/.claude-mem/settings.json) — Existing Chroma setup
- [vector-inspector](https://github.com/you/vector-inspector) — Debugging tool for embeddings

---

**Status**: Design documented, not yet implemented

**Owner**: Anthony Dawson

**Priority**: Medium (nice-to-have once memory system scales past 100 entries)

## Recent Updates (June 10, 2026)

### Completed
- ✅ TypeScript scaffold with strict mode
- ✅ Core libraries (embedder, chroma-client, memory-loader)
- ✅ Multi-source support (project + user, memory + docs)
- ✅ `/configure` skill for easy setup
- ✅ Memory maintenance features (`/audit-stale`, `/update-memory`)
- ✅ Smart `/create-memory` with similarity-based routing
- ✅ Configurable capture modes (propose vs auto)
- ✅ Git merge strategy (rebuild on conflict)

### In Progress (Starting Friday)
- ⏳ Embedding pipeline script
- ⏳ Query hook implementation
- ⏳ File watcher for auto-rebuild
- ⏳ Skill implementations
- ⏳ Testing framework
- ⏳ Example memory files

### Key Decisions Since Design

1. **Four-source architecture**: projectMemory, projectDocs, userMemory, userDocs (not two)
2. **Maintenance-first**: `/audit-stale` and similarity checks built-in from start
3. **Smart routing**: `/create-memory` checks duplicates, auto-routes to update
4. **Capture modes**: `propose` (safe, default) vs `auto` (autonomous) 
5. **File-based ChromaDB**: Committed to git, no server needed

See README.md for user-facing documentation.

## Multi-Project Sources (Parent/Submodule)

### Use Case: Submodule with Parent Context

```
/monorepo/               # Parent repo with general patterns
  .claude/memory/        # Shared patterns
  automation/            # Submodule (or subdirectory)
    .claude/memory/      # Automation-specific patterns
```

Working in `automation/`, you want context from BOTH:
- `automation/.claude/memory/` (local, specific)
- `../​.claude/memory/` (parent, shared)

### Configuration

**Manual (explicit):**
```json
{
  "claudeContextus": {
    "sources": {
      "projectMemory": {
        "path": ".claude/memory",
        "enabled": true
      },
      "custom": [
        {
          "type": "memory",
          "scope": "project",
          "path": "../​.claude/memory",
          "enabled": true,
          "indexFile": "MEMORY.md",
          "label": "parent-repo"
        }
      ]
    }
  }
}
```

**Auto-detection (future):**
```javascript
// Check for parent .claude/memory/ automatically
const cwd = process.cwd();
const parent = path.resolve(cwd, '../​');
if (fs.existsSync(path.join(parent, '.claude/memory'))) {
  // Auto-add parent as custom source
}
```

### Query Behavior

All sources searched together:
1. Project memory (automation-specific)
2. Project docs (automation docs)
3. Parent memory (if configured)
4. Parent docs (if configured)  
5. User memory (cross-project)
6. User docs (cross-project)

Results merged by similarity, labeled by source:
```
Top matches:
  1. [automation] testing/feedback_wdio_patterns.md (0.94)
  2. [parent] framework/feedback_typescript_strict.md (0.89)
  3. [user] ~/​.claude/memory/general/feedback_git_workflow.md (0.85)
```

### Use Cases

**1. Monorepo with submodules:**
- Parent: Shared team conventions
- Submodule: Project-specific patterns

**2. Related projects:**
```json
"custom": [
  {
    "path": "../​backend/.claude/memory",
    "label": "backend"
  },
  {
    "path": "../​frontend/.claude/memory", 
    "label": "frontend"
  }
]
```
Working on mobile, reference backend/frontend patterns.

**3. Template/library repos:**
```json
"custom": [
  {
    "path": "~/​src/my-framework/.claude/memory",
    "label": "framework-patterns"
  }
]
```
Every project using the framework pulls its patterns.

### Configuration via /configure

```bash
# Add custom source
/configure add-source ../​.claude/memory --label parent

# Remove custom source
/configure remove-source parent

# List all sources
/configure list-sources

# Output:
✓ projectMemory: .claude/memory (64 files)
✓ projectDocs: docs (23 files)
✓ custom[parent]: ../​.claude/memory (87 files)
✓ userMemory: ~/.claude/memory (12 files)
✓ userDocs: ~/.claude/docs (8 files)

Total: 194 knowledge files indexed
```

### ChromaDB Collection Strategy

**Option A: Single collection, source metadata**
```javascript
{
  id: "automation/testing/feedback_example.md",
  metadata: { source: "projectMemory", ... }
}
{
  id: "parent/framework/feedback_example.md", 
  metadata: { source: "custom:parent", ... }
}
```

**Option B: Multiple collections, union query**
- `automation-memory` collection
- `parent-memory` collection
- Query both, merge results

**Decision: Option A** (simpler, single collection with source metadata)

### Rebuild Behavior

```bash
/rebuild-embeddings

→ Scans all configured sources
→ Embeds: projectMemory, projectDocs, custom sources, userMemory, userDocs
→ 194 files total
→ Time: ~15-20 seconds
```

Automatic rebuild triggers on file changes in ANY source (if watched).

## Auto-Detection of Custom Sources

### Discovery Strategy

When `/configure discover` is run (or on first plugin load):

```javascript
async function discoverMemorySources(cwd: string): Promise<DiscoveredSource[]> {
  const discovered: DiscoveredSource[] = [];
  
  // 1. Check parent directories (up to git root or 3 levels)
  let current = path.resolve(cwd, '..');
  let depth = 0;
  while (depth < 3 && !isGitRoot(current)) {
    const memPath = path.join(current, '.claude/memory');
    if (fs.existsSync(memPath)) {
      discovered.push({
        type: 'parent',
        path: path.relative(cwd, memPath),
        label: `parent${depth > 0 ? `-${depth}` : ''}`,
        fileCount: countFiles(memPath)
      });
    }
    current = path.resolve(current, '..');
    depth++;
  }
  
  // 2. Check sibling directories (same parent)
  const parent = path.resolve(cwd, '..');
  const siblings = fs.readdirSync(parent, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== path.basename(cwd));
  
  for (const sibling of siblings) {
    const memPath = path.join(parent, sibling.name, '.claude/memory');
    if (fs.existsSync(memPath)) {
      discovered.push({
        type: 'sibling',
        path: path.relative(cwd, memPath),
        label: sibling.name,
        fileCount: countFiles(memPath)
      });
    }
  }
  
  // 3. Check for common framework locations (optional)
  const commonPaths = [
    '~/src/my-framework/.claude/memory',
    '~/src/shared-patterns/.claude/memory'
  ];
  
  for (const commonPath of commonPaths) {
    const expanded = expandHome(commonPath);
    if (fs.existsSync(expanded)) {
      discovered.push({
        type: 'framework',
        path: commonPath,
        label: path.basename(path.dirname(expanded)),
        fileCount: countFiles(expanded)
      });
    }
  }
  
  return discovered;
}
```

### Interactive Setup

```bash
/configure discover

# Output:
🔍 Scanning for nearby memory sources...

Found 4 memory sources:

[1] Parent: ../​.claude/memory
    87 files (framework patterns, team conventions)
    
[2] Sibling (backend): ../​backend/.claude/memory  
    42 files (API patterns, database schemas)
    
[3] Sibling (frontend): ../​frontend/.claude/memory
    31 files (UI patterns, component guidelines)
    
[4] Framework: ~/​src/my-framework/.claude/memory
    156 files (framework-specific patterns)

Enable which sources?
  [1-4] - specific numbers
  [all] - enable all
  [none] - skip

Your choice: 1,2
```

Result:
```
✓ Enabled parent: ../​.claude/memory
✓ Enabled backend: ../​backend/.claude/memory

Run /rebuild-embeddings to index new sources.
```

### Configuration Storage

Added sources appear in `.claude/settings.json`:

```json
{
  "claudeContextus": {
    "sources": {
      "projectMemory": { ... },
      "projectDocs": { ... },
      "custom": [
        {
          "type": "memory",
          "scope": "project",
          "path": "../​.claude/memory",
          "enabled": true,
          "label": "parent",
          "indexFile": "MEMORY.md"
        },
        {
          "type": "memory",
          "scope": "project",
          "path": "../​backend/.claude/memory",
          "enabled": true,
          "label": "backend",
          "indexFile": "MEMORY.md"
        }
      ]
    }
  }
}
```

### Manual Override

Still support explicit paths:

```bash
# Add specific source
/configure add-source ~/​external/project/.claude/memory --label external

# Remove discovered source
/configure remove-source parent

# Re-scan for changes
/configure discover --rescan
```

### Memory Creation with Multiple Sources

When creating memories, context from all sources but writes go to appropriate location:

```bash
# Default: project memory (always)
/create-memory "pattern discovered"
→ Checks: parent, backend, user memory for duplicates
→ Writes to: .claude/memory/ (this project)

# User memory (cross-project)
/create-memory "pattern discovered" --global
→ Checks: all sources for duplicates
→ Writes to: ~/.claude/memory/

# Custom sources: READ-ONLY
# To edit parent patterns, navigate to parent and work there
```

### First-Run Experience

```bash
# User starts in submodule/child project
cd ~/​src/monorepo/automation

# Plugin loads, detects parent .claude/memory/
🔍 Detected parent memory source: ../​.claude/memory (87 files)

Enable parent source for richer context? [Y/n]: y

✓ Enabled parent source
✓ Indexing 151 files (64 project + 87 parent)...
✓ Ready! Context from both project and parent available.
```

This makes multi-project setup automatic instead of manual.

## Custom Sources: Read vs Write

**Key Design Decision:** Custom sources (parent, siblings, frameworks) are **READ-ONLY** for retrieval but not for creation/updates.

### Rationale

1. **Prevent unintended modifications**
   - Child projects shouldn't modify parent patterns
   - Sibling projects shouldn't cross-contaminate
   - Framework repos shouldn't be edited from consuming projects

2. **Clear ownership**
   - Project memory belongs to the project
   - User memory belongs to the user
   - Parent/sibling memory belongs to parent/sibling

3. **Deliberate edits**
   - Want to edit parent? Navigate to parent and work there
   - Ensures you see full context when modifying shared patterns

### Implementation

```typescript
// When creating memory
async function getWriteTarget(scope: 'project' | 'user'): Promise<string> {
  if (scope === 'user') {
    return config.sources.userMemory.path;  // ~/.claude/memory
  }
  return config.sources.projectMemory.path;  // .claude/memory
}

// Custom sources never returned as write targets
// They only appear in read queries
async function getAllReadSources(): Promise<SourceConfig[]> {
  const sources = [
    config.sources.projectMemory,
    config.sources.projectDocs,
    config.sources.userMemory,
    config.sources.userDocs
  ];
  
  if (config.sources.custom) {
    sources.push(...config.sources.custom.filter(s => s.enabled));
  }
  
  return sources;
}
```

### User Experience

```bash
# Scenario: Working in submodule, want to update parent pattern

# ❌ Won't work (custom sources read-only)
cd ~/​src/monorepo/automation
/update-memory parent/framework/feedback_example.md
→ Error: Custom sources are read-only. Navigate to parent to edit.

# ✓ Correct approach
cd ~/​src/monorepo
/update-memory framework/feedback_example.md
→ Opens editor, updates parent memory
```

This keeps the mental model simple:
- **Your project** = can read + write
- **Your global settings** = can read + write (with `--global`)
- **Everything else** = read-only reference

## ChromaDB Location: Named Per-Project DBs

### The Simple Model

**Always use per-project databases in user space:**

```
~/.claude/<project-name>-memory-db/
```

No modes, no switching, no complexity. Just one pattern that works for everyone.

### Structure

```
~/.claude/contextus/
  dbs/
    automation/                   # automation project context
    backend/                      # backend project context  
    my-personal-site/             # personal site context
```

Each database contains:
- Project memories (`.claude/memory/`)
- Project docs (`docs/`)
- Custom sources (if configured: parent, siblings, frameworks)
- User memories (`~/.claude/memory/`)
- User docs (`~/.claude/docs/`)

**All in one database, one query, simple.**

### Why This Works

**✅ Clean project directories:**
```
automation/
  .claude/
    memory/              # Git-tracked, team-shared
    settings.json        # Personal config (gitignored)
  docs/                  # Git-tracked, team-shared
```

No `.claude/memory-db/` cluttering the project. Just the source files.

**✅ Context isolation:**
```bash
cd automation
# Query: ~/.claude/automation-memory-db/
# Results: automation + my-equip-mobile + user memories

cd backend
# Query: ~/.claude/backend-memory-db/
# Results: backend + frontend + user memories

# No cross-contamination!
```

**✅ Personal configuration:**
- Your custom sources, your DB
- Teammate has different sources? Different DB
- No git conflicts, no team coordination needed

**✅ Fast rebuild:**
```bash
git clone automation
cd automation

# First prompt triggers auto-build
→ Building ~/.claude/contextus/data/automation/
→ Indexing 151 files (64 project + 87 parent + user)
→ ✓ Ready! (~15-20 seconds)
```

### Configuration

```json
// No mode needed! Just derive from project name
{
  "chroma": {
    "path": "~/.claude/contextus/data/{project-name}"
  }
}
```

Project name derived from:
1. Git repo name (preferred)
2. Directory basename (fallback)
3. User override via config (edge cases)

### Handling User Memories

User memories (`~/.claude/memory/`) are embedded in **every project DB**.

**Why duplicate instead of separate DB?**
- ✅ Single query per prompt (fast)
- ✅ Simple implementation
- ✅ Disk is cheap (~5-10MB per project)
- ✅ Auto-rebuild keeps them in sync

**When user memory changes:**
```bash
vim ~/.claude/memory/feedback_git.md

# File watcher detects change
→ Rebuilding automation: ~/.claude/contextus/data/automation/
→ Rebuilding backend: ~/.claude/contextus/data/backend/
→ ✓ All projects updated (2-3 sec each)
```

### Edge Case: Name Collisions

If you have multiple projects with the same name:

```json
{
  "chroma": {
    "projectId": "automation-mobile"  // Override default
  }
}
```

DB becomes `~/.claude/contextus/data/automation-mobile/`.

Rare, but handled.

### What's NOT Stored in Git

```gitignore
# .gitignore (always include)
.claude/settings.json       # Personal config (sources, preferences)
```

Embeddings live in `~/.claude/`, never in project. Source files (`.claude/memory/`) are git-tracked, team-shared.

### Benefits Summary

| Aspect | Benefit |
|--------|---------|
| **Simplicity** | One pattern, no modes or switching |
| **Clean repos** | No DB files in project directories |
| **Isolation** | Each project has its own context bubble |
| **Personal** | Your sources, your DB, no team conflicts |
| **Fast** | Single query, all context together |
| **Predictable** | Same behavior for everyone |

## Server Mode (Optional)

For users who prefer or already run a ChromaDB server (like claude-mem does):

### Configuration

```json
{
  "chroma": {
    "mode": "server",
    "host": "localhost",
    "port": 8000,
    "collection": "{project-name}-contextus"
  }
}
```

### Behavior

**File mode (default):**
```
~/.claude/contextus/data/
  automation/       # File-based ChromaDB instance
  backend/          # File-based ChromaDB instance
```

**Server mode:**
```
ChromaDB server (localhost:8000)
  Collections:
    - automation-contextus
    - backend-contextus
```

Same isolation, different storage backend.

### When to Use Server Mode

**File mode is preferred for most users:**
- ✅ No separate server to manage
- ✅ Portable (just files)
- ✅ Fast enough for typical use

**Use server mode if:**
- Already running ChromaDB server for other tools
- Want to share embeddings across machines (network access)
- Managing 50+ projects (server may handle better)
- Prefer centralized management

### Migration

```bash
# Switch to server mode
/configure chroma-mode server --host localhost --port 8000

# Migrate existing data
/rebuild-embeddings --migrate
→ Uploads ~/.claude/contextus/data/{project}/ to server
→ Collection: {project}-contextus
→ ✓ Migrated to server

# Switch back to file mode
/configure chroma-mode file
/rebuild-embeddings --migrate
→ Downloads collection {project}-contextus
→ Writes to ~/.claude/contextus/data/{project}/
→ ✓ Migrated to file mode
```

**Default stays file mode** — simpler, no dependencies.

## Future Improvements

### Vector Store Abstraction

Currently hardcoded to ChromaDB. Could abstract to support multiple vector databases:

```typescript
// lib/vector-store.ts
interface VectorStore {
  upsert(id: string, embedding: number[], metadata: object): Promise<void>;
  query(embedding: number[], topK: number): Promise<Match[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

// Implementations:
class ChromaStore implements VectorStore { ... }
class PineconeStore implements VectorStore { ... }
class QdrantStore implements VectorStore { ... }
class WeaviateStore implements VectorStore { ... }
class PGVectorStore implements VectorStore { ... }
```

**Configuration:**
```json
{
  "vectorStore": {
    "provider": "chroma",  // or "pinecone", "qdrant", "weaviate", "pgvector"
    "config": {
      // Provider-specific config
    }
  }
}
```

**Benefits:**
- Users can choose their preferred vector DB
- Cloud-hosted options (Pinecone, Weaviate Cloud)
- Integrate with existing infrastructure (PostgreSQL + pgvector)
- Performance comparison across providers

**Implementation priority:** Low (v2+)
- ChromaDB (file + server) covers most use cases
- Abstraction adds complexity without clear demand yet
- Add when users request specific providers

### Other Potential Improvements

- **Hybrid search**: Combine semantic + keyword matching
- **Re-ranking**: Use cross-encoder for better top-k selection
- **Clustering**: Group related memories for better organization
- **Memory versioning**: Track changes over time, rollback support
- **Collaborative filtering**: "Users who found X useful also found Y useful"
- **Multi-language support**: Embeddings for non-English memories
- **Memory analytics**: Usage stats, which memories are most retrieved

---

## Design Review Summary

This document has been updated to incorporate decisions from the design review captured in [DESIGN ADDENDUM.md](./DESIGN%20ADDENDUM.md).

**Key architectural decisions:**

1. **Storage location**: ChromaDB in `~/.claude/contextus/data/{project}/` (user space), not git-committed
2. **Daemon architecture**: Persistent HTTP daemon instead of stateless hooks (solves model warm-up latency)
3. **Daemon lifecycle**: Single shared daemon across all projects (one embedding model), graceful degradation on crash
4. **Chunking strategy**: Chunk long docs with breadcrumb injection, relative paths for portability
5. **Embedding model validation**: Store model name in collection metadata, validate on query to prevent silent failures
6. **Awareness hook**: Opt-out framing ("omit only if trivial"), separate script for cross-platform safety
7. **Result destructuring**: Correct Chroma parallel array handling (ids/documents/metadatas/distances)

**Pre-implementation checklist** (see addendum §9 for full details):

Before implementation:
- [ ] Benchmark embedding models (MiniLM vs mpnet vs voyage-code-2)
- [ ] Design daemon API contract (endpoints, request/response shapes)
- [ ] Confirm chunk size/overlap strategy for different models
- [ ] Test awareness hook wording in real sessions

During implementation:
- [ ] Add `/health` endpoint to daemon for startup checks
- [ ] Implement `ensureDaemonRunning()` shared utility (SessionStart + crash recovery)
- [ ] Handle chunked results with breadcrumb deduplication in `formatMemoriesForInjection`
- [ ] Store embedding model in Chroma metadata, validate on every query
- [ ] Wire PostToolUse hook to daemon `/notify` for incremental re-embed

See [DESIGN ADDENDUM.md](./DESIGN%20ADDENDUM.md) for full rationale and additional context on each decision.
