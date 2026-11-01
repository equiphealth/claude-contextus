---
name: configure
description: View and edit contextus project config (.claude/contextus.json) — sources, excludes, retrieval tuning, docs settings, capture mode. The single entry point for all config changes.
---

# Configure Contextus

View or modify the project-level config (`.claude/contextus.json`). This is the
team-shared, git-committed configuration — it wins over global defaults via the 3-tier
merge (`plugin.json defaults` < `~/.contextus/data/<project>/config.json` < `.claude/contextus.json`).

**Exception: `embedding.*` is NOT a `/configure set` key at all — it has no
per-project override, in ANY tier.** `lib/embedding/embedder.ts` reads
`loadConfig()` exclusively (every call site — pipeline, warmup, raw embed) —
the global merge only, never project-aware. There is exactly one loaded
model process-wide, serving every project's corpus from the same daemon. A
per-project override in `.claude/contextus.json` (tier 3) OR
`~/.contextus/data/<project>/config.json` (tier 2) is silently IGNORED by the
actual embed call — it would make `/configure show` lie about what's really
happening, which is worse than refusing. If a user asks to "switch this
project's embedding provider": there is no such operation. Tell them so, and
see "Switch embedding provider" below for what changing it for real actually
requires. Caught live (2026-11-01): a stale tier-3 override on contextus's
own dogfood project caused a model-id mismatch exactly this way — see
`gotchas/gotcha-embedding-provider-switch.md`.

## Usage

```bash
/configure                    # show current effective config
/configure show               # same
/configure set <key> <value>  # set a config value
/configure exclude <glob>     # add an exclude pattern to a source
/configure sources            # list sources with file counts + excludes
```

## Config File: `.claude/contextus.json`

```json
{
  "docs": {
    "requireFrontmatter": true
  },
  "sources": {
    "projectDocs": {
      "exclude": ["prompts/**", "archive/**"]
    },
    "projectContext": {
      "exclude": []
    }
  },
  "retrieval": {
    "topK": 5,
    "injectionFloor": 0.35,
    "similarityThreshold": 0.7,
    "maxTokens": 3000
  },
  "contextCapture": {
    "mode": "staging"
  }
}
```

`embedding` is deliberately NOT shown in this example — see the exception
above. Its shape (for the machine-local tier-2 file) is documented separately
below.

## Configuration Reference

### `docs` — Documentation handling

| Key | Type | Default | Description |
|---|---|---|---|
| `requireFrontmatter` | boolean | `false` | Whether audit/migrate check docs for frontmatter |

### `sources` — Per-source overrides

Each source (`projectContext`, `projectDocs`, `userContext`, `userDocs`) accepts:

| Key | Type | Default | Description |
|---|---|---|---|
| `path` | string | (per source) | Override the source directory |
| `enabled` | boolean | `true` | Enable/disable this source |
| `exclude` | string[] | `[]` | Glob patterns to exclude (merged with defaults) |

**Default excludes** (always applied, you don't need to repeat these):
- `**/CONTEXT.md`, `**/DOCS.md`, `**/README.md`

**Your excludes are ADDITIVE** — they merge with defaults, never replace them.

Example — exclude `docs/prompts/` and `docs/archive/` from embedding:

```json
{
  "sources": {
    "projectDocs": {
      "exclude": ["prompts/**", "archive/**"]
    }
  }
}
```

### `retrieval` — Search and injection tuning

| Key | Type | Default | Description |
|---|---|---|---|
| `topK` | number | `5` | Max patterns to retrieve per prompt |
| `injectionFloor` | number | `0.35` | Min similarity to inject (below = skip) |
| `similarityThreshold` | number | `0.7` | Ideal similarity target (for calibration) |
| `maxTokens` | number | `3000` | Token budget for injected context |

### `embedding` — Model and provider (GLOBAL ONLY — not a `/configure` key, see exception above)

| Key | Type | Default | Description |
|---|---|---|---|
| `provider` | `"ollama"` \| `"transformers"` | `"transformers"` | Embedding backend |
| `ollamaModel` | string | `"nomic-embed-text"` | Ollama model name |
| `dimensions` | number | `768` | Vector dimensions (must match model) |

Lives ONLY in `plugin.jsonc`'s shipped default — `lib/embedding/embedder.ts`
never reads a project-scoped config for this, so nothing written via
`/configure set` or any project file changes it. Shown here for the field
shapes only, so you recognize them if you see this block in `plugin.jsonc`
or a `/health` response.

### `contextCapture` — How new patterns are proposed

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | `"propose"` \| `"staging"` \| `"silent"` | `"staging"` | Capture mode (permanent tradeoff) — `"staging"` writes patterns directly via `/capture`, using `git status` as the review gate; `"propose"` suggests via footer instead, you confirm with `/create-context` |
| `captureFooter` | `"always"` \| `"off"` | `"always"` | Whether a successful capture emits a "Context: captured [scope]: ..." confirmation line (scope is `user` or `project`) |
| `stopGate` | boolean | `false` | **Prototype.** When `true`, a `Stop` hook blocks turn completion once if a `git commit` ran this turn with no `/capture` logged since — asks for a `/capture` call or an explicit `Context: capture-skip: <why>` acknowledgment. The block reason is visible to the user too (Claude Code shows all Stop-hook block messages, not just to the model) — this is loud by design, not a bug. Toggle with `/configure set contextCapture.stopGate true` (or `false` to turn it back off). See `decisions/decision-capture-enforcement-needs-a-stop-hook-not-wording.md`. |

### `calibration` — Quality measurement

| Key | Type | Default | Description |
|---|---|---|---|
| `evaluateUsage` | boolean | `false` | Whether to run quality eval on retrievals |
| `targetSamples` | number | `100` | Samples before auto-disabling evaluation |

## Common Operations

### Exclude a directory from embedding

```bash
/configure exclude docs/prompts
# → Adds "prompts/**" to sources.projectDocs.exclude
```

### Change retrieval aggressiveness

```bash
/configure set retrieval.topK 8
/configure set retrieval.injectionFloor 0.4
```

### Switch embedding provider

**Not a `/configure set` operation — don't suggest it.** There's no
per-project embedding override (see the exception above); the provider is
whatever the single daemon process loaded, shared by every project's corpus
on this machine. It's not impossible to change, it's just a bigger
operation than any other setting here:

1. Edit `plugin.jsonc`'s `embedding` block directly (the only thing
   `lib/embedding/embedder.ts`'s `loadConfig()` actually reads) — this is a
   real edit to a git-tracked file, so treat it like any other code change
   (branch + PR in this repo; for an installed plugin, the machine's own
   copy).
2. Restart the daemon (`/manage-daemon restart`) — the new model only loads
   on a fresh process.
3. `/rebuild-embeddings --full` for **every** project on this machine, plus
   user scope (`~/.contextus/context`, `~/.contextus/docs`) — not just the
   one you were thinking about. Every corpus the daemon serves must move
   together; a partial rebuild just recreates the mismatch elsewhere.

See `gotchas/gotcha-embedding-provider-switch.md` for why steps 2-3 aren't
optional, and the "stay on transformers" decision history for why this
isn't something to do casually.

### Disable a source entirely

```bash
/configure set sources.userDocs.enabled false
```

## Precedence (3-tier merge)

1. **Plugin defaults** (`plugin.json config`) — ships with contextus
2. **Machine-local** (`~/.contextus/data/<project>/config.json`) — `/context-calibrate --apply` writes here. NOT where `embedding.*` goes (see exception above) — this tier is still project-scoped, and embedding has no project scope at all.
3. **Project config** (`.claude/contextus.json`) — git-committed, team-shared, **WINS**

Later tiers override earlier ones. Source `exclude` arrays are **merged** (additive),
not replaced — your project excludes add to the defaults, they don't clobber them.

## Setup Integration

`/contextus-setup` asks initial config questions and writes this file. Re-run setup
or use `/configure` directly to change settings later.

## After Config Changes

- **Source excludes changed** → `/rebuild-embeddings` (removed files stay in corpus until rebuild)
- **Source disabled** → `/rebuild-embeddings --full` (removes all rows from that source)
- **Retrieval tuning** → takes effect on next prompt (no rebuild needed)
- **Embedding provider/model** → `/rebuild-embeddings --full` (vectors incompatible across models)

## Related

- `/contextus-setup` — initial config + scaffold (asks questions interactively)
- `/rebuild-embeddings` — re-embed after source/exclude changes
- `/context-status` — verify config is taking effect
