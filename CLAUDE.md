# claude-contextus

**Proactive context delivery for Claude Code** — automatic semantic retrieval from `.claude/context/`, injected on every prompt without querying.

## Project Status

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

**Git workflow** (CRITICAL — no branch protection, manual discipline required):
- **NEVER commit directly to main** — all changes must go through a feature branch and PR
- Branch naming: `feat/`, `fix/`, `docs/`, `chore/`
- Create PR for every change (even typos, docs, context updates)
- Squash-merge to keep main history clean
- See `decisions/decision-pr-workflow-no-direct-main-commits.md` for full rationale

**Key directories**:
- `daemon/` — HTTP server (query, notify, reconcile, health endpoints)
- `lib/` — Core logic (config, embedding, retrieval, calibration, logging)
- `scripts/` — Hook scripts (plain JS, no build step) + CLI tools (TS, run via tsx)
- `hooks/` — Hook registration (`hooks.json`)
- `skills/` — 26 plugin skills (`/ctx <subcommand>` dispatcher for shortcuts)
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
- **Daemon code changes**: Restart daemon before verification (`/manage-daemon restart`) — tests actual deployment path, not shortcuts. Direct script execution (`npx tsx ...`) bypasses daemon and may show false positive.

**When documenting discoveries**:
- Durable patterns → `.claude/context/<category>/` (auto-embedded)
- Comprehensive guides → `docs/`
- **You MUST propose context capture** (`Context: propose: <topic>`) after implementation work that surfaces new patterns, decisions, gotchas, or workflow knowledge. Don't wait to be asked — insights that aren't proposed die with the session.

**Bug documentation lifecycle** (see `decisions/decision-bug-documentation-lifecycle.md`):
- **Bug discovered** → Capture as `gotcha/gotcha-<slug>.md` with symptoms, root cause, workaround
- **Bug fixed** → In the SAME commit: (1) Remove the gotcha file, (2) Create `implementation/implementation-<slug>.md` with fix details
- **Rationale**: Prevents stale advice. A gotcha saying "X is broken, use workaround Y" becomes WRONG after the fix. Implementation notes document the fix for future reference without misleading readers.
- **Exception**: Upstream bugs stay as gotchas until fixed upstream

**When testing skills**:
- **Always execute skills fully** — Run all commands, show actual results, don't skip steps or summarize "what would happen"
- **Minimal narration** — Present results directly with minimal descriptive overhead (unless context is needed)
- Show real diagnostic output, real status dashboards, real search results

**Documentation standards**:
- Use generic placeholders (`my-project`, `example-app`) or contextus self-references only
- Never reference other real project names from this machine in docs/contexts/examples

## Core Principles (do not re-litigate)

1. **Proactive delivery over search** — Context injected automatically, not on-demand
2. **Quality over vanity metrics** — Calibration evaluates actual usage, not token savings
3. **Config hot-reload** — Edit a file, next query picks it up. No restarts.
4. **Injection floor is critical** — Not every prompt should receive context (0.45 default)
5. **Graceful degradation** — Daemon down? Hook returns `continue: true`. Expansion fails? Results still return. Never block a prompt.
6. **File-based everything** — Session state, configs, logs. No external services.
7. **Transparency** — Log what was dropped, what was skipped, what fired. `contextus watch` for live tail.

## Skills

**Quick access:** Use `/ctx <subcommand>` for common operations (like `npm run`):

| Shortcut | Canonical Skill | Purpose |
|----------|-----------------|---------|
| `/ctx status` | `/context-status` | Health dashboard |
| `/ctx stats` | `/context-stats` | Usage analytics |
| `/ctx create` | `/create-context` | Capture a new pattern |
| `/ctx calibrate` | `/context-calibrate` | Floor calibration + usage-eval |
| `/ctx doctor` | `/context-doctor` | Troubleshoot issues |
| `/ctx watch` | `/contextus-watch` | Live daemon activity stream |
| `/ctx migrate` | `/migrate-memory` | Convert .claude/memory/ → context |
| `/ctx tag` | `/context-tag` | Add/manage tags |
| `/ctx daemon` | `/manage-daemon` | Start/stop/restart daemon |
| `/ctx setup` | `/contextus-setup` | Setup wizard |
| `/ctx search` | `/context-search` | Find patterns |
| `/ctx review` | `/context-review` | Curate corpus |
| `/ctx rebuild` | `/rebuild-embeddings` | Rebuild embeddings |

Run `/ctx` with no args to see all 18 shortcuts.

Other skills: `/configure`, `/link-project`, `/context-audit`, `/context-archive`, `/context-merge`, `/contextus-upgrade`

## Expansion Pipeline

Multi-vector query expansion generates alternate phrasings when initial search scores poorly:
- **Adaptive** (default): fires when best_score < 0.55
- **Always**: every query (+100-200ms latency)
- **Off**: disabled

Provider chain: ollama (qwen2.5:3b, ~100-400ms) → bedrock fallback (Haiku, ~2s) on fast failures. Shared time budget — slow timeouts don't fall back.

<!-- contextus:start -->
## Context (claude-contextus)

This project uses [claude-contextus](https://github.com/equiphealth/claude-contextus):
relevant patterns from `.claude/context/`, `docs/`, `~/.contextus/`, and linked projects 
are **retrieved and injected automatically** on each prompt — you don't need to search 
for them. Injected blocks are tagged `[contextus — …]`.

Context capture behavior is controlled by the per-prompt injected footer — follow
its instructions exactly (it may tell you to propose, write directly, or stay silent).
New context files live under `.claude/context/<category>/` and are embedded automatically.
<!-- contextus:end -->
