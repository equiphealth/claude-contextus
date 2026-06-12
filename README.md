<p align="center">
  <img src="assets/wordmark.png" width="400" alt="contextus">
</p>

<p align="center">
  <strong>Proactive context for Claude Code</strong><br>
  Stop searching for patterns — let them find you.
</p>

## Overview

**claude-contextus** makes your knowledge base work for you instead of the other way around. Store patterns, decisions, and documentation in markdown — the plugin **automatically** surfaces relevant context on every prompt AND captures new patterns as you discover them. No manual queries, no "remember to search," no "did I write that down?" — just proactive retrieval and capture.

**Unlike other RAG tools**, claude-contextus doesn't wait for you to act. It:

- **Surfaces relevant context** automatically on every prompt (no queries needed)
- **Proposes new patterns** as you work, calibrating to what matters in your project
- **Searches semantically** across project + user context patterns and docs
- **Learns what's useful** by tracking which patterns actually help (retrieval quality feedback loop)
- **Rebuilds embeddings** automatically when files change

Think of it as a context system that reads your mind — captures what you learn, surfaces what you need, tunes itself to your workflow.

## Features

### 🎯 Proactive (Not Reactive)

- **Zero-query context injection**: Relevant context patterns appear automatically on every prompt
- **Calibrated pattern capture**: System proposes new patterns as you work, learns what's worth remembering
- **Automatic quality tuning**: Tracks which patterns are actually useful vs. just retrieved
- **Automatic rebuilds**: Embeddings stay fresh as your knowledge grows

### 🧠 Smart Retrieval

- **Semantic search**: Finds by meaning, not keywords ("How do I debug?" → matches Logger patterns)
- **Multi-source**: Searches project context patterns, project docs, user context patterns, and user docs simultaneously
- **Configurable relevance**: Tune similarity threshold and top-k per your needs

### 📝 Team-Friendly

- **Markdown-based**: Human-readable, easy to edit, git-trackable
- **Per-user storage**: Embeddings stored in `~/.contextus/data/` (per-user, per-project)
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

On first use, embeddings are generated and stored in `~/.contextus/data/{project}/` (per-user, not committed to git).

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
    "retrieval": {
      "topK": 5,
      "similarityThreshold": 0.7,
      "dedupThreshold": 0.85,
      "maxTokens": 3000
    },
    "capture": {
      "mode": "propose" // propose | auto | manual
    },
    "embedding": {
      "provider": "transformers.js",
      "model": "nomic-ai/nomic-embed-text-v1.5"
    },
    "sources": {
      "projectContext": { "enabled": true, "path": ".claude/context" },
      "projectDocs": { "enabled": true, "path": "docs" },
      "userContext": { "enabled": true },
      "userDocs": { "enabled": true }
    }
  }
}
```

## How It Works

1. **Daemon**: Persistent HTTP server keeps embedding model warm (~100-200ms per query)
2. **Auto-injection**: Every prompt triggers semantic search → top-k patterns injected automatically
3. **Pattern proposals**: System suggests new patterns as you work ("Context: propose: topic-name")
4. **Calibration**: Tracks hit counts, learns which patterns are useful, tunes retrieval over time
5. **Multi-source**: Searches project context, project docs, user context, user docs simultaneously
6. **Compression**: Retrieved patterns compressed before injection (lean-ctx style, ~60% reduction)

**No API keys needed**: Uses local transformers.js or Ollama for embeddings.

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

**Embeddings are per-user**: Stored in `~/.contextus/data/{project}/`, not committed to git. Each team member maintains their own embedding database, automatically rebuilt when context files change.

```bash
# .gitignore (embeddings should NOT be committed)
.contextus/

# .git/hooks/post-merge (optional: auto-rebuild on context file changes)
if git diff --name-only ORIG_HEAD HEAD | grep -q "\.claude/context/"; then
  npm run rebuild
fi
```

On merge conflicts in context patterns, resolve like any markdown file. Embeddings rebuild automatically from source.

## Architecture

```
UserPromptSubmit Hook
    ↓
HTTP request → Daemon (warm model)
    ↓
Embed prompt (50-100ms)
    ↓
Query ChromaDB (5-20ms)
    ↓
Re-rank by source/type/freshness/hits (<5ms)
    ↓
Compress patterns (~60% reduction, <5ms)
    ↓
Inject into Claude context
    ↓
Claude responds (context-aware)
    ↓
Track hit counts → learn what's useful
```

**Total latency**: 100-200ms typical (p50), 300-500ms worst case (p95)

**Storage**: `~/.contextus/data/{project}/` — per-user, per-project ChromaDB instances. No git conflicts, automatic rebuilds on context file changes.

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

## Do You Need Another Memory System?

**Short answer: probably not.**

claude-contextus handles workflow patterns, decisions, and documentation — the knowledge that actually guides your work. For most users, that's sufficient.

**Power user combo**: [claude-mem](https://github.com/thedotmack/claude-mem) adds temporal observation tracking (_"what we tried last sprint"_) if you need historical recall across sessions. It's complementary, not required — contextus is proactive and automatic, claude-mem is manual and search-based.

If you're not sure, start with contextus. Add claude-mem later if you find yourself needing to recall specific past sessions.

## License

MIT © Anthony Dawson

## Contributing

Issues and PRs welcome! This is a vacation project but I'm happy to collaborate.

---

**Status**: 🚧 In Development (Week 0: Planning & Scaffolding)
