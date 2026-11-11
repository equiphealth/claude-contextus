<p align="center">
  <img src="assets/wordmark.png" width="400" alt="contextus">
</p>

<p align="center">
  <strong>Proactive context for Claude Code</strong><br>
  Stop searching for patterns — let them find you.
</p>

<p align="center">
  <a href="https://github.com/equiphealth/claude-contextus/releases">
    <img src="https://img.shields.io/github/v/release/equiphealth/claude-contextus" alt="Latest Release">
  </a>
  <a href="https://github.com/equiphealth/claude-contextus/actions/workflows/test.yml">
    <img src="https://github.com/equiphealth/claude-contextus/actions/workflows/test.yml/badge.svg" alt="Test">
  </a>
  <a href="https://github.com/equiphealth/claude-contextus/actions/workflows/release.yml">
    <img src="https://github.com/equiphealth/claude-contextus/actions/workflows/release.yml/badge.svg" alt="Release">
  </a>
</p>

## Overview

**Problem**: Claude forgets your architecture decisions, coding patterns, and project conventions between sessions. You spend time re-explaining the same context, or worse — Claude gives advice that contradicts decisions you made last week.

**Solution**: claude-contextus automatically captures and surfaces project knowledge as you work. When you discover a pattern or make a decision, Contextus captures it — either by writing the file directly (default: `staging` mode, reviewed at your normal `git add`/commit time) or by proposing it first (`propose` mode). On future prompts, Claude sees that context automatically — no manual searching, no "remember to look this up."

**How it works**:
1. You work with Claude as normal
2. Contextus captures patterns you discover (decisions, gotchas, conventions) — silently in `staging` mode, or via a one-line proposal footer in `propose` mode
3. Claude sees them automatically when relevant

The system stores everything as markdown files (git-trackable, human-readable, merge-friendly) — you *can* edit them directly, but most users let the capture flow handle it.

## Why Contextus?

**Captures knowledge as you discover it.**

Most RAG tools require you to write documentation upfront. Contextus learns from your work — when you debug an issue, make an architectural choice, or discover a gotcha, it offers to capture that knowledge. No separate "documentation time," no context-switching.

**Works without Ollama, works better with Ollama.**

Starts with keyword search (zero setup), upgrades to semantic embeddings when you add Ollama or Transformers.js. No infrastructure gate blocking day-one value.

**Proactive, not reactive.**

Injects relevant context automatically on every prompt. You capture patterns once, Claude sees them forever — no manual "check the docs" step.

**One file per pattern, all in git.**

Markdown files, human-readable, merge-friendly, version-controlled. No vendor lock-in, no binary formats. Your knowledge is YOUR data, editable in any text editor.

## Features

**See [docs/FEATURES.md](docs/FEATURES.md) for comprehensive coverage** — this is the highlight reel.

### 🎯 Proactive (Not Reactive)

- **Zero-query injection** — Context appears automatically on every prompt, no manual searching
- **Learns what's useful** — Tracks which patterns actually help vs. just retrieved
- **Automatic rebuilds** — Embeddings stay fresh as your knowledge grows
- **Pattern capture** — Writes new patterns as you discover them (`staging`/`propose`/`silent` modes — see [Configuration](#configuration))

### 🧠 Smart Retrieval

- **Hybrid search** — Fuses semantic + keyword (RRF), nails exact symbols ("getLogger") that pure embeddings miss
- **Multi-vector expansion** — Generates alternate phrasings when search scores poorly, dramatically improves recall
- **Keyword fallback** — When provider is down, falls back to BM25 so you still get context
- **Multi-source** — Searches project + user patterns and docs simultaneously

### 📊 Observability & Tuning

- **Token cost reporting** — Shows overhead % paired with usage rate (`/context-status --cost`)
- **Calibration tools** — Tune injection floor from real usage data (`/context-calibrate`)
- **Live activity stream** — Watch retrievals in real time (`/contextus-watch`)
- **Self-documenting** — Introspect endpoint exposes config + corpus stats

### 🛠️ Integrated Workflow

- **24 skills** — Setup, create, audit, archive, merge, search, tag, calibrate, debug, mine
- **Auto-hooks** — File changes trigger rebuilds, prompts inject context
- **JSONC config** — Hot-reload (no restart), comments allowed
- **Team-friendly** — Markdown files, git-trackable, merge-friendly

## Requirements

### Retrieval Modes

✓ **Keyword search only** (zero setup — works immediately)  
✓ **Local embeddings via Ollama** (recommended: `ollama pull nomic-embed-text`)  
✓ **Local embeddings via Transformers.js** (in-process, one-time model download)  
✓ **Automatic fallback** when embeddings unavailable

**Start with keyword search, add semantic search later if you want better recall.** The system works without Ollama — it just works *better* with it.

### Other Requirements

- **Claude Code** (CLI, desktop, or IDE extension)
- **Node 22+** — the daemon runs on it (`engine-strict` enforces this on install)
- **A C/C++ build toolchain** on the target machine — the native `@lancedb` bindings
  build during install (Xcode CLT on macOS; `build-essential` on Linux)

## Installation

> ⚠️ **Marketplace install untested on clean machines.** The flow below is wired but
> unverified end-to-end — use `--plugin-dir` for now until smoke-tested.

**[v1.1 — GitHub marketplace]** Add the marketplace, then install:

```text
/plugin marketplace add equiphealth/claude-contextus
/plugin install contextus@claude-contextus
```

Hooks activate automatically (no enable step), the daemon starts on your next session
(first launch installs native deps — one-time latency), and skills appear under the
`/context-*` / `/contextus-*` namespace.

**[v1 today — clone + `--plugin-dir`]** Until the marketplace listing is live:

```bash
git clone https://github.com/equiphealth/claude-contextus ~/src/claude-contextus
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

On first use, embeddings are generated and stored in `~/.contextus/data/` — a single shared database with per-project scoping (per-user, not committed to git).

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
- `/mine-transcripts` — Retrospectively mine past session transcripts for patterns never captured live
- `/tag-context` — Backfill topical tags on untagged context files

**Health, tuning & troubleshooting**
- `/context-status` — Impact dashboard (corpus size, injection rate, latency)
- `/context-stats` — Usage analytics (what's working, what's noisy, what's stale)
- `/context-doctor` — Diagnose problems (no injections, wrong corpus, phantom re-embeds)
- `/context-calibrate` — Tune the per-project injection floor + usage-eval refinement
- `/context-search <query>` — Manual semantic search (debugging; shows scores + floor)
- `/rebuild-embeddings` — Regenerate all embeddings from scratch
- `/context-archive` — Archive stale/unused patterns (moves to `.claude/context/.archive/`)
- `/context-merge` — LLM-assisted merge of duplicate/overlapping patterns
- `/context-audit` — Validate structure, flag staleness and zero-hit patterns
- `/configure` — Adjust configuration
- `/ctx` — Quick dispatcher for the above (`/ctx status`, `/ctx create`, …) — run with no args to see all shortcuts

See **[docs/usage.md](docs/usage.md)** and **[docs/calibration.md](docs/calibration.md)**
for day-to-day workflows and tuning.

## Configuration

Config resolves through **3 tiers (later wins)**:

1. **`plugin.json`** `config` block — the shipped global default
2. **`~/.contextus/data/<project>/config.json`** — machine-local, per-project (where
   `/context-calibrate --floor --apply` writes)
3. **`<project>/.claude/contextus.json`** — git-committed, team-shared, **wins**

Only include the keys you're overriding. The shape (from `plugin.json`):

The embedding provider, model (`model` or `ollamaModel`), and dimensions are
global settings in `plugin.json`. Project-level overrides of these fields are
rejected because all projects share one embedding database. Other embedding
settings can still be overridden per project.

```json
{
  "config": {
    "enabled": true,
    "retrieval": {
      "topK": 5,
      "injectionFloor": 0.45,
      "maxTokens": 3000
    },
    "contextCapture": { "mode": "staging" },
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

**`contextCapture.mode`** has three settings:
- **`staging`** (default) — Claude writes context files directly via the daemon's `POST /capture`; they land as untracked/modified files in `git status` and ship (or don't) with your normal commit/PR review
- **`propose`** — Claude ends its response with `Context: propose: <topic>`; you approve before `/create-context` runs
- **`silent`** — capture prompting is suppressed entirely

**`contextCapture.stopGate`** (prototype, default `false`) — the modes above are all soft nudges read at the *start* of a turn, competing with whatever task is live; a `git commit` with no matching capture can slip through unnoticed. When enabled, a `Stop` hook blocks turn completion once if a commit happened this turn with no capture logged since, asking for a `/capture` call or an explicit `Context: capture-skip: <why>` acknowledgment. The block reason is visible to you too — Claude Code surfaces every Stop-hook block message, not just to the model — that's by design, not a bug. Toggle with `/configure set contextCapture.stopGate true` (or `false`).

## How It Works

1. **Daemon**: Persistent HTTP server keeps embedding model warm (~100-200ms per query)
2. **Auto-injection**: Every prompt triggers semantic search → top-k patterns injected automatically
3. **Pattern capture**: New patterns are captured as you work — written directly in `staging` mode, or proposed via a footer in `propose` mode
4. **Calibration**: Tracks hit counts, learns which patterns are useful, tunes retrieval over time
5. **Multi-source**: Searches project context, project docs, user context, user docs simultaneously
6. **Compression**: Retrieved patterns compressed before injection (lean-ctx style, ~60% reduction)

**No API keys needed**: Uses local transformers.js or Ollama for embeddings.

## Context Pattern File Format

```markdown
---
name: typescript-strict-mode
description: Always use TypeScript strict mode to avoid runtime errors
metadata:
  type: decision
  tags: [typescript, config, strict-mode]
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

**Storage**: `~/.contextus/data/` — single shared LanceDB with per-project scoping via hash column. Per-user, not committed to git, automatic rebuilds on context file changes.

## Development

Requires **Node 22** (`engine-strict` enforces it). Install with your package manager
of choice:

```bash
pnpm install          # builds native deps (@lancedb, @xenova/transformers)

pnpm build            # compile to dist/ (auto-built on first run; not committed)
pnpm test             # run test suite
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

### Advisory pre-PR review

`pnpm review` runs an advisory Claude Code review over your changes before you push or
open a PR. Standalone script for now — not wired into any git hook.

```bash
pnpm review       # what's new since your last push (or the whole branch, if unpushed) + staged
pnpm review:pr    # the entire local branch vs main, committed only
```

Never blocks anything (always exits 0) and never modifies files. Report is streamed to
the terminal and saved to `.pre-pr-review.md` (git-ignored).

```bash
SKIP_AI_REVIEW=1 pnpm review                        # opt out for a single run
git config contextus.aiReview.enabled false         # disable entirely
git config contextus.aiReview.model opus            # stronger model (or AI_REVIEW_MODEL=opus)
```

## Examples

See `examples/` directory for:

- Sample context pattern files
- Example configurations
- Common patterns
- Migration scripts

## Roadmap

- [x] Phase 1: Embedding pipeline (LanceDB + nomic-embed-text)
- [x] Phase 2: Daemon + query hook integration
- [x] Phase 3: Skills implementation
- [x] Phase 4: Reconcile, calibration infrastructure
- [x] Phase 5: Self-documentation, introspection, stop-eval hook
- [x] Phase 6: Multi-source (docs + user packs), chunking, packaging
- [x] Phase 7: Transcript mining (extract patterns from session logs, recurring + setup-triggered)
- [ ] v2: Context-Aware Evaluation (CAE), tag-based retrieval, removal governance

See [docs/dev/V2_ROADMAP.md](docs/dev/V2_ROADMAP.md) for the current backlog.

## Do You Need Another Memory System?

**Short answer: probably not.**

claude-contextus handles workflow patterns, decisions, and documentation — the knowledge that actually guides your work. For most users, that's sufficient.

**Power user combo**: [claude-mem](https://github.com/thedotmack/claude-mem) adds temporal observation tracking (_"what we tried last sprint"_) if you need historical recall across sessions. It's complementary, not required — contextus is proactive and automatic, claude-mem is manual and search-based.

If you're not sure, start with contextus. Add claude-mem later if you find yourself needing to recall specific past sessions.

## Contributing

Contributions welcome! I review issues and PRs as time permits and I'm happy to collaborate.

Original concept by Anthony Dawson; built using Equip Health, Inc. resources, which owns the original work.

## License

Licensed under the MIT License — see [LICENSE](LICENSE).

---

**Status**: v0.19.1 — daemon, embedding pipeline, retrieval, hooks, skills, and transcript mining all working. See [docs/dev/V2_ROADMAP.md](docs/dev/V2_ROADMAP.md) for what's next.
