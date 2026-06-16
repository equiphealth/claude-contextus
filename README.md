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

## Requirements

- **Claude Code** (CLI, desktop, or IDE extension)
- **Node 22+** — the daemon runs on it (`engine-strict` enforces this on install)
- **A C/C++ build toolchain** on the target machine — the native `@lancedb` bindings
  build during install (Xcode CLT on macOS; `build-essential` on Linux)
- **An embedding provider**: [Ollama](https://ollama.com) (recommended, local, private —
  `ollama pull nomic-embed-text`) or Transformers.js (in-process; needs a one-time
  Hugging Face model download, which some corporate networks block)

## Installation

> ⚠️ **Untested as of 2026-06-15.** The marketplace flow below is wired up but has
> **not** been verified on a real clean-machine install — use `--plugin-dir` for now.
> Tracked as a smoke-test before this is the recommended path.

**[v1.1 — GitHub marketplace]** Add the marketplace, then install:

```text
/plugin marketplace add anthonypdawson/claude-contextus
/plugin install contextus@claude-contextus
```

Hooks activate automatically (no enable step), the daemon starts on your next session
(first launch installs native deps — one-time latency), and skills appear under the
`/context-*` / `/contextus-*` namespace.

**[v1 today — clone + `--plugin-dir`]** Until the marketplace listing is live:

```bash
git clone https://github.com/anthonypdawson/claude-contextus ~/src/claude-contextus
cd ~/src/claude-contextus && pnpm install   # builds the native deps; needs Node 22
# then, in any project you want contextus active:
claude --plugin-dir ~/src/claude-contextus
```

> **Note:** the `claude plugin install` command and an `enabledPlugins` settings block
> are NOT how this installs — use the marketplace flow above. See
> [docs/quick-start.md](docs/quick-start.md) for the full walkthrough.

## Quick Start

See **[docs/quick-start.md](docs/quick-start.md)** for the 5-minute version. The short
form:

### 1. Set up the project

```text
/contextus-setup
```

Scaffolds `.claude/context/`, registers a small marked stanza in your `CLAUDE.md`, and
builds the initial embedding corpus. Migrating from an older `.claude/memory/` system?
Run `/migrate-memory` (see [docs/MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md)).

### 2. Create your first context pattern

```bash
/create-context "Always use TypeScript strict mode" "We've had issues with `any` types causing runtime errors"
```

### 3. Embeddings build automatically

On first use, embeddings are generated and stored in `~/.contextus/data/{project}/` (per-user, not committed to git).

### 4. Automatic context injection

Ask a question, and relevant context patterns are injected automatically:

```
You: "How should I handle errors in TypeScript?"

Claude: [Sees relevant "TypeScript strict mode" context pattern injected]
"Based on our patterns, always use strict mode and avoid `any` types..."
```

## Skills

**Setup & capture**
- `/contextus-setup` — First-run setup for a project (scaffold + CLAUDE.md stanza + embed)
- `/create-context <topic> <content>` — Create a new context pattern with validation
- `/add-patterns <file> <patterns>` — Add patterns to an existing context file
- `/create-doc <topic> <content>` — Create a documentation file
- `/migrate-memory` — Convert a legacy `.claude/memory/` system into context files
- `/tag-context` — Backfill topical tags on untagged context files

**Health, tuning & troubleshooting**
- `/context-status` — Impact dashboard (corpus size, injection rate, latency)
- `/context-doctor` — Diagnose problems (no injections, wrong corpus, phantom re-embeds)
- `/context-calibrate` — Tune the per-project injection floor + usage-eval refinement
- `/context-search <query>` — Manual semantic search (debugging; shows scores + floor)
- `/rebuild-embeddings` — Regenerate all embeddings from scratch
- `/audit-context`, `/audit-stale` — Validate structure / flag stale patterns
- `/configure` — Adjust configuration

See **[docs/usage.md](docs/usage.md)** and **[docs/calibration.md](docs/calibration.md)**
for day-to-day workflows and tuning.

## Configuration

Config resolves through **3 tiers (later wins)**:

1. **`plugin.json`** `config` block — the shipped global default
2. **`~/.contextus/data/<project>/config.json`** — machine-local, per-project (where
   `/context-calibrate --floor --apply` writes)
3. **`<project>/.claude/contextus.json`** — git-committed, team-shared, **wins**

Only include the keys you're overriding. The shape (from `plugin.json`):

```json
{
  "config": {
    "enabled": true,
    "retrieval": {
      "topK": 5,
      "injectionFloor": 0.45,
      "maxTokens": 3000
    },
    "contextCapture": { "mode": "propose" },
    "embedding": {
      "provider": "ollama",
      "ollamaModel": "nomic-embed-text",
      "model": "nomic-ai/nomic-embed-text-v1.5"
    }
  }
}
```

> **`injectionFloor`, not a fixed threshold.** It's the gate ("inject anything at
> all?") and it's **per-project** — calibrate it to your corpus rather than trusting a
> universal default. See [docs/calibration.md](docs/calibration.md).

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
Query LanceDB (5-20ms)
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

**Storage**: `~/.contextus/data/{project}/` — per-user, per-project LanceDB databases. No git conflicts, automatic rebuilds on context file changes.

## Development

Requires **Node 22** (`engine-strict` enforces it). Install with your package manager
of choice:

```bash
pnpm install          # builds native deps (@lancedb / @xenova)

pnpm build            # compile to dist/ (committed; the daemon runs node dist/...)
pnpm run verify:dist  # rebuild + assert committed dist/ is fresh (CI runs this)
pnpm test             # 137 tests
pnpm lint
```

Working on contextus's *own* corpus (e.g. dogfooding it on this repo), the package
scripts are fine:

```bash
pnpm embed                                  # build/refresh this repo's corpus
pnpm query "your query"                     # replay retrieval (scores + floor)
```

> **Targeting a *different* project?** Don't use `pnpm --prefix` — it sets cwd to the
> contextus repo and embeds the wrong corpus. Run the repo-local tsx by path with the
> target project as cwd instead: `cd <target> && ~/src/claude-contextus/node_modules/.bin/tsx ~/src/claude-contextus/scripts/embed-contexts.ts`.
> The skills (`/contextus-setup`, `/migrate-memory`, …) handle this for you.

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

**Status**: 🚧 Design Complete, Implementation Starting (see [IMPLEMENTATION_ESTIMATE.md](docs/dev/IMPLEMENTATION_ESTIMATE.md))
