---
name: configure
description: View and edit contextus project config (.claude/contextus.json) — sources, excludes, retrieval tuning, docs settings, capture mode. The single entry point for all config changes.
---

# Configure Contextus

View or modify the project-level config (`.claude/contextus.json`). This is the
team-shared, git-committed configuration — it wins over global defaults via the 3-tier
merge (`plugin.json defaults` < `~/.contextus/data/<project>/config.json` < `.claude/contextus.json`).

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
  "embedding": {
    "provider": "ollama",
    "ollamaModel": "nomic-embed-text"
  },
  "capture": {
    "mode": "propose"
  }
}
```

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

### `embedding` — Model and provider

| Key | Type | Default | Description |
|---|---|---|---|
| `provider` | `"ollama"` \| `"transformers"` | `"ollama"` | Embedding backend |
| `ollamaModel` | string | `"nomic-embed-text"` | Ollama model name |
| `dimensions` | number | `768` | Vector dimensions (must match model) |

### `capture` — How new patterns are proposed

| Key | Type | Default | Description |
|---|---|---|---|
| `mode` | `"propose"` \| `"auto"` \| `"silent"` | `"propose"` | Capture mode (permanent tradeoff) |

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

```bash
/configure set embedding.provider ollama
# Reminder: requires /rebuild-embeddings --full after switching
```

### Disable a source entirely

```bash
/configure set sources.userDocs.enabled false
```

## Precedence (3-tier merge)

1. **Plugin defaults** (`plugin.json config`) — ships with contextus
2. **Machine-local** (`~/.contextus/data/<project>/config.json`) — `/context-calibrate --apply` writes here
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
