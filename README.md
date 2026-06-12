# claude-contextus

> **Proactive context for Claude Code**: Stop searching for patterns — let them find you.

## Overview

**claude-contextus** makes your knowledge base work for you instead of the other way around. Store patterns, decisions, and documentation in markdown — the plugin **automatically** surfaces relevant context on every prompt AND captures new patterns as you discover them. No manual queries, no "remember to search," no "did I write that down?" — just proactive retrieval and capture.

**Unlike other RAG tools**, claude-contextus doesn't wait for you to act. It:
- **Surfaces relevant context** automatically on every prompt (no queries needed)
- **Captures new patterns** automatically by prompting Claude to propose context patterns
- **Searches semantically** across project + user context patterns and docs
- **Rebuilds embeddings** automatically when files change

Think of it as a context system that reads your mind — and reminds you to write things down.

## Features

### 🎯 Proactive (Not Reactive)
- **Zero-query context injection**: Relevant context patterns appear automatically on every prompt
- **Context awareness prompts**: Reminds Claude to capture new patterns as you discover them
- **Automatic rebuilds**: Embeddings stay fresh as your knowledge grows

### 🧠 Smart Retrieval
- **Semantic search**: Finds by meaning, not keywords ("How do I debug?" → matches Logger patterns)
- **Multi-source**: Searches project context patterns, project docs, user context patterns, and user docs simultaneously
- **Configurable relevance**: Tune similarity threshold and top-k per your needs

### 📝 Team-Friendly
- **Markdown-based**: Human-readable, easy to edit, git-trackable
- **Per-user storage**: Embeddings stored in `~/.claude/contextus/data/` (per-user, per-project)
- **Merge-friendly**: No binary merge conflicts — embeddings are derived artifacts

### 🛠️ Integrated Workflow
- **Management skills**: `/create-context`, `/create-doc`, `/configure`, `/audit-context`
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

### 2. Create context directory structure

```
.claude/
└── context/
    ├── CONTEXT.md          # Index (human-readable)
    ├── README.md           # Documentation
    └── framework/
        └── feedback_example.md
```

### 3. Create your first context pattern

```bash
/create-context "Always use TypeScript strict mode" "We've had issues with `any` types causing runtime errors"
```

### 4. Embeddings build automatically

On first use, embeddings are generated and stored in `~/.claude/contextus/data/{project}/` (per-user, not committed to git).

### 5. Automatic context injection

Ask a question, and relevant context patterns are injected automatically:

```
You: "How should I handle errors in TypeScript?"

Claude: [Sees relevant "TypeScript strict mode" context pattern injected]
"Based on our patterns, always use strict mode and avoid `any` types..."
```

## Skills

- `/create-context <topic> <content>` - Create a new context pattern with validation
- `/create-doc <topic> <content>` - Create documentation file
- `/add-patterns <file> <patterns>` - Add patterns to existing context file
- `/rebuild-embeddings` - Regenerate all embeddings from scratch
- `/context-search <query>` - Manual semantic search (debugging)
- `/context-debug` - Show stats and tuning suggestions
- `/audit-context` - Validate context structure and check duplicates

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

1. **Context Pattern Creation**: Write markdown files in `.claude/context/` with frontmatter
2. **Embedding**: Files are embedded using a local transformer model (no API keys)
3. **Storage**: Embeddings stored in file-based ChromaDB (`~/.claude/contextus/data/{project}/`)
4. **Retrieval**: On every prompt, semantic search finds top-k relevant context patterns
5. **Injection**: Matched context patterns injected into Claude's context automatically

## Context Pattern File Format

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

**Context patterns are version controlled**: Commit `.claude/context/` to your project repository.

**Embeddings are per-user**: Stored in `~/.claude/contextus/data/{project}/`, not committed to git. Each team member maintains their own embedding database, automatically rebuilt when context files change.

```bash
# .gitignore (embeddings should NOT be committed)
.claude/contextus/

# .git/hooks/post-merge (optional: auto-rebuild on context file changes)
if git diff --name-only ORIG_HEAD HEAD | grep -q "\.claude/context/"; then
  npm run rebuild
fi
```

On merge conflicts in context patterns, resolve like any markdown file. Embeddings rebuild automatically from source.

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
Inject top-k context patterns into context
    ↓
Claude responds with relevant context patterns
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
- Sample context pattern files
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

- [claude-mem](https://github.com/thedotmack/claude-mem) - Observation-based memory (temporal, what you did)
- **claude-contextus** - Context patterns (timeless, what you learned)

**Difference**: claude-mem captures *what you did* (observations with timestamps), claude-contextus stores *what you learned* (timeless patterns and decisions).

## License

MIT © Anthony Dawson

## Contributing

Issues and PRs welcome! This is a vacation project but I'm happy to collaborate.

---

**Status**: 🚧 In Development (Week 0: Planning & Scaffolding)
