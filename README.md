# claude-contextus

> **Proactive context for Claude Code**: Stop searching for patterns — let them find you.

## Overview

**claude-contextus** makes your knowledge base work for you instead of the other way around. Store patterns, decisions, and documentation in markdown — the plugin **automatically** surfaces what's relevant on every prompt. No manual queries, no "remember to search" — just natural, proactive context injection.

**Unlike other RAG tools**, claude-contextus doesn't wait for you to ask. It:
- **Watches every prompt** you send
- **Searches semantically** across memories and docs
- **Injects relevant context** automatically
- **Reminds you to capture** new patterns

Think of it as a memory system that reads your mind.

## Features

### 🎯 Proactive (Not Reactive)
- **Zero-query context injection**: Relevant memories appear automatically on every prompt
- **Memory awareness prompts**: Reminds Claude to capture new patterns as you discover them
- **Automatic rebuilds**: Embeddings stay fresh as your knowledge grows

### 🧠 Smart Retrieval
- **Semantic search**: Finds by meaning, not keywords ("How do I debug?" → matches Logger patterns)
- **Multi-source**: Searches project memory, project docs, user memory, and user docs simultaneously
- **Configurable relevance**: Tune similarity threshold and top-k per your needs

### 📝 Team-Friendly
- **Markdown-based**: Human-readable, easy to edit, git-trackable
- **File-based ChromaDB**: Embeddings committed with your repo (no server needed)
- **Merge-friendly**: Rebuild on conflict, deterministic results

### 🛠️ Integrated Workflow
- **Management skills**: `/create-memory`, `/create-doc`, `/configure`, `/audit-memory`
- **Auto-hooks**: Captures file changes, triggers rebuilds, injects context
- **User + project scope**: Personal patterns persist across all projects

## Installation

```bash
# Clone or install via Claude plugin registry
claude plugin install claude-contextus

# Or install from local directory
claude plugin install ~/src/claude-contextus
```

## Quick Start

### 1. Enable in your project

```json
// .claude/settings.json
{
  "enabledPlugins": {
    "claude-contextus": true
  }
}
```

### 2. Create memory directory structure

```
.claude/
└── memory/
    ├── MEMORY.md          # Index (human-readable)
    ├── README.md          # Documentation
    └── framework/
        └── feedback_example.md
```

### 3. Create your first memory

```bash
/create-memory "Always use TypeScript strict mode" "We've had issues with `any` types causing runtime errors"
```

### 4. Embeddings build automatically

On first use, embeddings are generated and stored in `.claude/memory-db/` (committed to git).

### 5. Automatic context injection

Ask a question, and relevant memories are injected automatically:

```
You: "How should I handle errors in TypeScript?"

Claude: [Sees relevant "TypeScript strict mode" memory injected]
"Based on our patterns, always use strict mode and avoid `any` types..."
```

## Skills

- `/create-memory <topic> <context>` - Create a new memory with validation
- `/create-doc <topic> <context>` - Create documentation file
- `/add-patterns <file> <patterns>` - Add patterns to existing memory
- `/rebuild-embeddings` - Regenerate all embeddings from scratch
- `/search-memory <query>` - Manual semantic search (debugging)
- `/debug-memory` - Show stats and tuning suggestions
- `/audit-memory` - Validate memory structure and check duplicates

## Configuration

```json
// .claude/settings.json
{
  "claudeContextus": {
    "enabled": true,
    "autoRebuild": true,
    "retrieval": {
      "topK": 5,
      "similarityThreshold": 0.7,
      "maxTokens": 3000
    },
    "embedding": {
      "model": "Xenova/all-MiniLM-L6-v2"
    }
  }
}
```

## How It Works

1. **Memory Creation**: Write markdown files in `.claude/memory/` with frontmatter
2. **Embedding**: Files are embedded using a local transformer model (no API keys)
3. **Storage**: Embeddings stored in file-based ChromaDB (`.claude/memory-db/`)
4. **Retrieval**: On every prompt, semantic search finds top-k relevant memories
5. **Injection**: Matched memories injected into Claude's context automatically

## Memory File Format

```markdown
---
name: typescript-strict-mode
description: Always use TypeScript strict mode to avoid runtime errors
type: feedback
category: framework
---

# TypeScript Strict Mode

Always enable strict mode in `tsconfig.json`:

\`\`\`json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true
  }
}
\`\`\`

**Why**: We had several production bugs caused by `any` types...
```

## Git Integration

**Merge Strategy**: Treat ChromaDB as derived artifact

```bash
# .gitattributes
.claude/memory-db/* merge=ours

# .git/hooks/post-merge
if git diff --name-only ORIG_HEAD HEAD | grep -q "\.claude/memory/"; then
  npm run rebuild
fi
```

On conflict, rebuild from source (`.md` files).

## Architecture

```
UserPromptSubmit
    ↓
Embed user prompt
    ↓
Query ChromaDB (semantic search)
    ↓
Filter by similarity threshold
    ↓
Inject top-k memories into context
    ↓
Claude responds with relevant memory
```

**Local, no API keys**: Uses `@xenova/transformers` for embeddings (runs in Node.js, no external API).

## Development

```bash
# Install dependencies
npm install

# Run embedding pipeline
npm run embed

# Rebuild all embeddings
npm run rebuild

# Test query hook
echo '{"prompt": "How do I handle errors?"}' | npm run query

# Run tests
npm test

# Lint
npm run lint
```

## Examples

See `examples/` directory for:
- Sample memory files
- Example configurations
- Common patterns
- Migration scripts

## Roadmap

- [ ] Phase 1: Embedding pipeline (Week 1)
- [ ] Phase 2: Query hook integration (Week 2)
- [ ] Phase 3: Skills implementation (Week 3)
- [ ] Phase 4: Testing & tuning (Week 4)
- [ ] Phase 5: Documentation & publish (Week 5)

## Related Projects

- [claude-mem](https://github.com/thedotmack/claude-mem) - Observation-based memory (tool use tracking)
- **claude-contextus** - Pattern-based memory (curated knowledge)

**Difference**: claude-mem captures *what you did* (observations), claude-contextus stores *what you learned* (patterns).

## License

MIT © Anthony Dawson

## Contributing

Issues and PRs welcome! This is a vacation project but I'm happy to collaborate.

---

**Status**: 🚧 In Development (Week 0: Planning & Scaffolding)
