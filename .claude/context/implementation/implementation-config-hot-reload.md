---
name: config-hot-reload
description: How 3-tier config merging works and why no daemon restart is needed for config changes
metadata:
  type: implementation
  tags: [config, daemon, hot-reload, merge]
---

# Config Hot-Reload Implementation

Configuration **hot-reloads** on every `/query` request — edit any config file and the next query picks up changes. No daemon restart needed.

## 3-Tier Merge

Config resolves through three layers (lowest to highest precedence):

1. **Plugin defaults** — `plugin.jsonc` (ships with contextus)
2. **Per-project user overrides** — `~/.contextus/data/<project-name>/config.json` (machine-local)
3. **Git-committed overrides** — `.claude/contextus.jsonc` (team settings)

**Example:**

```jsonc
// plugin.jsonc (tier 1)
{
  "retrieval": {
    "topK": 5,
    "injectionFloor": 0.45
  }
}

// ~/.contextus/data/my-project/config.json (tier 2)
{
  "retrieval": {
    "topK": 3  // Override: I want fewer patterns
  }
}

// .claude/contextus.jsonc (tier 3)
{
  "retrieval": {
    "injectionFloor": 0.5  // Team override: stricter floor
  }
}

// Final merged config:
{
  "retrieval": {
    "topK": 3,               // tier 2 wins
    "injectionFloor": 0.5    // tier 3 wins
  }
}
```

## Why Three Tiers?

**Tier 1 (plugin.jsonc):** Universal defaults
- Ships with the plugin
- Updated by plugin maintainers
- Applies to all projects

**Tier 2 (user machine-local):** Personal tweaks
- Lives in `~/.contextus/data/` (never committed)
- Per-project basis
- Example: "I want topK=10 for this big repo, but topK=3 for others"

**Tier 3 (git-committed):** Team conventions
- Committed to `.claude/contextus.jsonc`
- Highest precedence (team settings override personal preferences)
- Example: "This repo uses strict floor=0.55 for quality"

## How Hot-Reload Works

**On every `/query` request:**

```typescript
async function handleQuery(body: Record<string, unknown>, res: http.ServerResponse) {
  const project = body.project;
  const cwd = body.cwd; // Project root for finding .claude/contextus.jsonc
  
  // Load fresh config for THIS request
  const cfg = loadProjectConfig(project, cwd);
  
  // Use cfg.retrieval.topK, cfg.retrieval.injectionFloor, etc.
  // ...
}
```

**No caching** — `loadProjectConfig()` reads files from disk every time.

**Cost:** ~1-2ms per query (file reads are fast, JSON parse is cheap).

## JSONC Support

All config files support:
- **Comments** — `// line comments` and `/* block comments */`
- **Trailing commas** — `{"foo": 1,}` is valid

JSONC is stripped before JSON.parse:

```typescript
function loadJSONC(path: string): Record<string, unknown> {
  const raw = fs.readFileSync(path, 'utf-8');
  const stripped = stripJsonComments(raw);
  return JSON.parse(stripped);
}
```

## Config Loading Functions

**Global config (tier 1 only):**
```typescript
loadConfig(): Config
// Reads plugin.jsonc, returns defaults
```

**Project-specific config (3-tier merge):**
```typescript
loadProjectConfig(project?: string, cwd?: string): Config
// Reads plugin.jsonc → user override → git-committed override
// Returns merged config for this project
```

**Use project config in daemon handlers** — it respects per-project overrides.

## When Restart IS Needed

**Daemon restart NOT needed for:**
- `retrieval.*` changes (topK, injectionFloor, hybrid, provenanceFooter)
- `expansion.*` changes (mode, threshold, maxVariants)
- `logging.*` changes (paranoid)
- `sources.*` changes (enable/disable project context, docs, user context)

**Daemon restart IS needed for:**
- **Embedding provider change** (transformers → ollama)
  - Model must be re-warmed
  - Corpus must be re-embedded (different provider = different vectors)
- **Provider endpoint change** (`providers.ollama.endpoint`)
  - Affects warmup behavior
- **Embedding dimensions change**
  - Corpus must be re-embedded (dimension mismatch = garbage similarities)

**Recommendation:** After embedding config changes, run:
```bash
pnpm daemon  # Restart daemon
pnpm embed   # Rebuild corpus
```

## Validating Config Changes

**Test without restarting:**

1. Edit `.claude/contextus.jsonc`
2. Save
3. Run: `./scripts/test-api.sh query "test query"`
4. Check logs: `tail ~/.contextus/logs/daemon.log`

If config is applied, logs will reflect new values (e.g., `topK: 3` instead of `topK: 5`).

## Provider Config (Shared)

Providers are defined once in `providers` block:

```jsonc
{
  "providers": {
    "ollama": {
      "endpoint": "http://localhost:11434"
    },
    "bedrock": {
      "region": "us-east-1"
    }
  }
}
```

All features (embedding, expansion, calibration) reference these shared provider configs.

## Config Precedence Example

**plugin.jsonc:**
```jsonc
{
  "retrieval": { "topK": 5, "injectionFloor": 0.45 },
  "expansion": { "mode": "adaptive" }
}
```

**~/.contextus/data/my-project/config.json:**
```jsonc
{
  "retrieval": { "topK": 3 }
}
```

**my-project/.claude/contextus.jsonc:**
```jsonc
{
  "expansion": { "mode": "always" }
}
```

**Final merged:**
```jsonc
{
  "retrieval": { "topK": 3, "injectionFloor": 0.45 },
  "expansion": { "mode": "always" }
}
```

## Observability

**/introspect shows merged config:**

```bash
curl -s "http://localhost:37800/introspect?project=/path/to/project" | jq .config
```

Shows exactly what config is active for that project (after 3-tier merge).

## Tradeoffs

**Pros:**
- No daemon restart for tuning (fast iteration)
- Per-project calibration (different floors for different repos)
- Team conventions via git-committed overrides
- Personal tweaks don't affect teammates (machine-local tier)

**Cons:**
- ~1-2ms overhead per query (file reads)
- Config changes not applied until NEXT query (not retroactive)
- Embedding config changes require manual daemon restart + re-embed

## Code Location

- `lib/config.ts` — 3-tier merge logic (loadConfig, loadProjectConfig)
- `daemon/server.ts` — Calls loadProjectConfig on every `/query` (line 201)
- `examples/contextus.jsonc` — Annotated reference config

## Related

- **/introspect** — Exposes merged config for debugging
- **Calibration** — Per-project floors tuned via git-committed overrides
- **Providers** — Shared provider configs referenced by all features
