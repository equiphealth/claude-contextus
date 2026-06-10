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
        "command": "echo '{\"hookSpecificOutput\": {\"additionalContext\": \"Memory awareness: For substantial responses, end with footer: Memory: used: filename(s) | Memory: propose: topic-name. Omit if brief/trivial. CRITICAL: If propose: in footer, MUST invoke /create-memory before sending response.\"}}'",
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

1. **Query Hook**: Semantic search + inject relevant memories
2. **Awareness Hook**: Remind Claude to propose new memories proactively
3. **Watch Hook**: Auto-rebuild embeddings when memory files change

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
      "model": "Xenova/all-MiniLM-L6-v2",
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
  const collection = await client.getOrCreateCollection('manual-memory');
  
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
  const relevant = results.distances[0]
    .map((dist, i) => ({ ...results[i], similarity: 1 - dist }))
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

### Phase 2: Query Hook

**Goal**: Add semantic retrieval to UserPromptSubmit hook

```bash
# Script: ~/.claude/scripts/claude-contextus-hook.js
# Input: User prompt (from UserPromptSubmit event)
# Process:
#   1. Embed user prompt
#   2. Query Chroma for top-k (k=5) similar memories
#   3. Filter by similarity threshold (e.g., >0.7)
#   4. Read matched memory files
#   5. Format as injection payload
# Output: JSON with memory contents for context injection
```

**Hook integration:**
```json
{
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "command": "node ~/.claude/scripts/claude-contextus-hook.js",
          "type": "command"
        }
      ],
      "matcher": ".*"
    }
  ]
}
```

**Output format:**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "additionalContext": "# Relevant Memories\n\n[Logger Helper]\n...\n\n[Test Artifacts]\n..."
  }
}
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

## Git Integration & Merge Strategy

### File-Based ChromaDB in Git

**Approach**: Store ChromaDB files in `.claude/memory-db/` and commit them.

**Benefits:**
- ✅ Team sharing: Everyone gets embeddings on clone
- ✅ Portability: No Chroma server required
- ✅ Version control: Embeddings tracked with memories
- ✅ Atomic updates: Memory + embedding in same commit

**Structure:**
```
.claude/
├── memory/
│   ├── MEMORY.md
│   ├── sdk/
│   ├── testing/
│   └── framework/
└── memory-db/              # Committed to git
    ├── chroma.sqlite3      # Binary SQLite
    └── <uuid>/             # Vector data
```

### Handling Merge Conflicts

**Problem**: Binary SQLite files don't merge cleanly.

**Solution: Rebuild on Conflict** (Recommended)

Treat ChromaDB as a **derived artifact** (like `package-lock.json`):
- Commit it for convenience (fast clone)
- On conflict, rebuild from source (`.md` files)
- Embeddings are deterministic → rebuild = correct

**Implementation:**

```bash
# .gitattributes
.claude/memory-db/* merge=ours

# .git/hooks/post-merge
#!/bin/bash
if git diff --name-only ORIG_HEAD HEAD | grep -q "\.claude/memory/.*\.md"; then
  echo "Memory files changed, rebuilding embeddings..."
  npm run rebuild-memory-embeddings
fi
```

**Workflow:**
1. **Develop**: Update memory files, embeddings auto-rebuild
2. **Commit**: Both `.md` and `.memory-db/` changes committed
3. **PR/Merge**: If conflict on ChromaDB, rebuild wins
4. **Post-merge hook**: Detects `.md` changes, rebuilds if needed

**Alternative: Gitignore ChromaDB**

If merge conflicts are too frequent:
```gitignore
.claude/memory-db/
```

Add SessionStart hook to rebuild if missing:
```bash
if [ ! -d ".claude/memory-db" ]; then
  npm run rebuild-memory-embeddings
fi
```

**Tradeoff**: First session after clone takes ~5-10s to rebuild.

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

## ChromaDB Location: Project vs User

### Configuration

```json
{
  "chroma": {
    "mode": "project",  // or "user"
    "path": ".claude/memory-db"  // project mode
    // OR
    "path": "~/.claude/memory-db"  // user mode
  }
}
```

### Project Mode (Default)

**Location:** `.claude/memory-db/` in project directory

**Use when:**
- Working on a team (shared embeddings via git)
- Want deterministic, portable setup
- Each project is independent

**Pros:**
- Git-committable (team can share exact embeddings)
- Portable (clone repo → embeddings included)
- Isolated (project changes don't affect others)

**Cons:**
- Duplicate embeddings when multiple projects reference same sources
- More disk space (each project has full DB)
- Rebuild needed in each project

**Example:**
```
monorepo/
  .claude/memory/          # Parent patterns
  .claude/memory-db/       # Parent embeddings
  automation/
    .claude/memory/        # Child patterns  
    .claude/memory-db/     # Child + parent embeddings (duplicate)
  backend/
    .claude/memory/        # Backend patterns
    .claude/memory-db/     # Backend + parent embeddings (duplicate)
```

Parent embedded 3x (once per project).

### User Mode

**Location:** `~/.claude/memory-db/` (global, outside projects)

**Use when:**
- Solo developer
- Working across many interconnected projects (5+)
- Frequently referencing shared sources (parent, framework)
- Want fast setup for new projects

**Pros:**
- No duplication (parent embedded once)
- Faster new project setup (just config, no rebuild)
- Less disk space (shared embeddings)
- Consistent across all projects

**Cons:**
- Not git-committable (personal only)
- Not portable (teammates must rebuild)
- Global state (rebuild affects all projects)

**Example:**
```
~/.claude/memory-db/      # Single global DB
  → Contains all sources from all projects

monorepo/
  .claude/memory/         # Parent patterns
  automation/
    .claude/memory/       # Child patterns
  backend/
    .claude/memory/       # Backend patterns
```

Parent embedded once, referenced by all.

### Hybrid Approach (Future)

```json
{
  "chroma": {
    "mode": "hybrid",
    "projectPath": ".claude/memory-db",    // Project-specific only
    "userPath": "~/.claude/memory-db"      // Shared sources
  }
}
```

- Project/user memory → project DB (git-committable)
- Custom sources → user DB (shared, efficient)

Best of both: portability + efficiency.

### Migration Between Modes

```bash
# Switch to user mode
/configure chroma-mode user

# Migrate existing embeddings
/rebuild-embeddings --migrate
→ Moves .claude/memory-db → ~/.claude/memory-db
→ Updates config

# Switch back to project mode
/configure chroma-mode project
/rebuild-embeddings --migrate
→ Moves ~/.claude/memory-db → .claude/memory-db
→ Updates config
```

### Recommendation

**Default:** `project` mode (safe, portable)

**Suggest `user` mode if:**
- User has 5+ projects configured
- Custom sources detected (parent/siblings)
- Same custom source used across multiple projects
- Disk space >100MB across all project DBs

Prompt:
```
💡 Detected 3 projects using parent source: ../​.claude/memory

Switch to user mode for shared embeddings?
  - Saves ~180MB disk space
  - Faster setup for new projects
  - Not git-committable (personal only)
  
Switch? [y/n]: 
```

This makes advanced users more efficient without complicating simple cases.
