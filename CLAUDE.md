# claude-contextus

**Proactive context delivery for Claude Code** — automatic semantic retrieval from `.claude/context/`, injected on every prompt without querying.

## Project Status

**Version**: 0.3.0  
**State**: Running in production (dogfooding across multiple repos)  
**Current work**: See `docs/dev/V2_ROADMAP.md` for backlog

## Architecture (30-second version)

```
UserPromptSubmit hook → daemon /query → embed prompt → vector search → rerank → inject
                                                      ↕ (adaptive)
                                               LLM expansion (ollama → bedrock fallback)
```

- **Daemon** (`daemon/server.ts`) — HTTP server on localhost, auto-started by SessionStart hook
- **Embedding** — nomic-embed-text via Ollama (768-dim), stored in LanceDB per-project
- **Retrieval** — similarity search + injection floor (0.45) + provenance footer
- **Expansion** — multi-vector query expansion when initial scores are weak (adaptive/always/off)
- **Calibration** — floor replay works (`/context-calibrate --floor`); post-prompt usage evaluation (Stop hook) not yet implemented
- **Config** — 3-tier merge: `plugin.jsonc` → `~/.contextus/data/<project>/config.json` → `.claude/contextus.jsonc`

## Config

All config files are **JSONC** (comments supported). Config hot-reloads on every query — no daemon restart needed for config changes.

- `plugin.jsonc` — Runtime defaults (ships with contextus)
- `.claude/contextus.jsonc` — Per-project overrides (git-committed, highest precedence)
- `examples/contextus.jsonc` — Annotated reference with every option explained

Provider connections (ollama, bedrock, anthropic) are defined once in `providers {}` and referenced by all features.

## Working with This Codebase

**Key directories**:
- `daemon/` — HTTP server (query, notify, reconcile, health endpoints)
- `lib/` — Core logic (config, embedding, retrieval, calibration, logging)
- `scripts/` — Hook scripts (plain JS, no build step) + CLI tools (TS, run via tsx)
- `hooks/` — Hook registration (`hooks.json`)
- `skills/` — 26 plugin skills (`/ctx-*` aliases for the primary ones)
- `prompts/` — Externalized prompt templates (editable without code changes)
- `.claude/context/` — This project's own context patterns (dogfood corpus)
- `docs/dev/` — Design docs, logging schema, roadmap

**Commands**:
```bash
pnpm test              # unit tests (node:test)
pnpm test:types        # tsc --noEmit
pnpm format            # prettier --write
pnpm embed             # rebuild corpus (usually handled by daemon auto-rebuild)
pnpm daemon            # start daemon manually (normally auto-started by hooks)
```

**When implementing**:
- Type-check with `npx tsc --noEmit` before committing
- Pre-commit hook checks prettier (install: `pnpm prepare`)
- Target ~80% test coverage — exports + edge cases + failures, skip internal-helper obsession
- JSONC everywhere — use `//` comments, no trailing commas

**When documenting discoveries**:
- Durable patterns → `.claude/context/<category>/` (auto-embedded)
- Comprehensive guides → `docs/`

## Core Principles (do not re-litigate)

1. **Proactive delivery over search** — Context injected automatically, not on-demand
2. **Quality over vanity metrics** — Calibration evaluates actual usage, not token savings
3. **Config hot-reload** — Edit a file, next query picks it up. No restarts.
4. **Injection floor is critical** — Not every prompt should receive context (0.45 default)
5. **Graceful degradation** — Daemon down? Hook returns `continue: true`. Expansion fails? Results still return. Never block a prompt.
6. **File-based everything** — Session state, configs, logs. No external services.
7. **Transparency** — Log what was dropped, what was skipped, what fired. `contextus watch` for live tail.

## Skills (primary)

| Skill | Alias | Purpose |
|-------|-------|---------|
| `/context-status` | `/ctx-status` | Health dashboard |
| `/context-calibrate` | `/ctx-calibrate` | Floor calibration works; usage-eval campaigns not yet |
| `/context-doctor` | `/ctx-doctor` | Troubleshoot issues (not yet implemented) |
| `/create-context` | `/ctx-create` | Capture a new pattern |
| `/context-search` | — | Search the corpus |
| `/contextus-watch` | `/ctx-watch` | Live daemon activity stream |
| `/migrate-memory` | `/ctx-migrate` | Convert .claude/memory/ → context |
| `/tag-context` | `/ctx-tag` | Add/manage tags on patterns |
| `/audit-context` | — | Review for duplicates/staleness |
| `/rebuild-embeddings` | — | Force full re-embed |

## Expansion Pipeline

Multi-vector query expansion generates alternate phrasings when initial search scores poorly:
- **Adaptive** (default): fires when best_score < 0.55
- **Always**: every query (+100-200ms latency)
- **Off**: disabled

Provider chain: ollama (qwen2.5:3b, ~100-400ms) → bedrock fallback (Haiku, ~2s) on fast failures. Shared time budget — slow timeouts don't fall back.

## Related Projects

- **claude-mem** — Session memory/observations (complementary: contextus = normative patterns, claude-mem = observational history)
- **vector-inspector** — Embedding visualization (informed Ollama quality assessment)

## Hardware Context

M4 Pro 48GB — makes local Ollama viable for both embedding and expansion. Bedrock (Haiku) for fallback/calibration via AWS default credential chain.

<!-- contextus:start -->
## Context (claude-contextus)

This project uses [claude-contextus](https://github.com/anthonypdawson/claude-contextus):
relevant patterns from `.claude/context/` are **retrieved and injected automatically**
on each prompt — you don't need to search for them. Injected blocks are tagged
`[contextus — …]`.

When you discover a durable pattern, decision, or gotcha worth keeping, you'll see
an awareness footer inviting you to propose it; new context files live under
`.claude/context/<category>/` and are embedded automatically when edited.
<!-- contextus:end -->
