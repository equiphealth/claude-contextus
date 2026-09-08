---
name: context-search
description: Search corpus by semantic similarity. Returns matching patterns with scores, descriptions, and types. Use --limit N for more results, --scores to show similarity.
---

# Context Search

Search the contextus corpus manually — useful for exploring what's available, debugging retrieval, or testing before committing changes.

## When to Use

- Explore what patterns exist on a topic
- Debug "why didn't X get retrieved?"
- Find related patterns before creating new ones
- Test retrieval quality before committing changes
- Browse corpus without writing a prompt

## How It Works

Queries the daemon's `/search` endpoint (`daemon/server.ts` — distinct from `/query`, which is what automatic injection uses) and presents ALL matches, not just those above the injection floor. This lets you see what's in the corpus even if it wouldn't normally inject.

**Search scope** (matches automatic retrieval):
- Current project's `.claude/context/` and `docs/`
- Linked projects (workspace siblings, if configured via `/link-project`)
- User-scoped patterns (`~/.contextus/data/__user__/`)

Override scope with `--project <name>` to search a different project. Note: this
re-expands to *that project's own* workspace scope (its siblings + `__user__`), not a
strict single-project view — see GH issue #62 if isolating to exactly one project matters
for what you're debugging.

## Usage

**Preferred: call the daemon directly with curl** — the daemon is already running
(same one `/capture` talks to), and this skips a subprocess spin-up entirely. The
daemon's base URL defaults to `http://127.0.0.1:37800` but can differ (env override or
a dynamic port written to `~/.contextus/runtime/daemon.port`) — respect
`CONTEXTUS_DAEMON_URL` when it's set rather than hardcoding the port:

```bash
curl -s -X POST "${CONTEXTUS_DAEMON_URL:-http://127.0.0.1:37800}/search" \
  -H 'content-type: application/json' \
  -d '{"query":"error handling patterns","cwd":"'"$(pwd)"'","limit":10}'
```

Body fields:

| Field | Description | Default |
|------|-------------|---------|
| `query` | Search text (required) | — |
| `limit` | Max results to return | 10 |
| `cwd` | Anchors scope resolution (workspace siblings + `__user__`) to this path | none |
| `project` | Target by hash, friendly name, or filesystem path instead of `cwd` (resolved via `resolveProjectId`; skips workspace-scope resolution if `cwd` is omitted) | none |

Response shape depends on how the request resolves — don't assume every field is always present:
- Empty/whitespace `query` → `{ results: [] }` only (no `query`/`project` fields)
- No corpus table yet for the resolved project → `{ results: [] }` only
- A real search → `{ results: [{ id, filename, description, type, source, similarity }], query, project }`
- Failure (bad JSON body, embedding/search error) → `{ error: "..." }` with a non-200 status

When there IS a full result set, it's unfiltered — no floor filtering, every match included, similarity and all, so you can see exactly where the injection floor would have cut it off.

**Alternative: the CLI wrapper** (`scripts/cli/context-search.ts`) — same daemon call under the hood, just formats output for a human reading a terminal (`--scores`, human-readable by default, `--json` for the raw form) instead of a directly-consumable JSON blob:

```bash
CONTEXTUS_ROOT=$(bash ~/.contextus/scripts/find-contextus-root.sh) || exit 1
SEARCH="$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/context-search.ts"

$SEARCH "error handling patterns" --limit 20 --scores
$SEARCH "deployment workflow" --project automation
```

Prefer curl when you (the agent) are the consumer — one less subprocess, and you get JSON directly instead of parsing formatted text back out. Use the CLI wrapper when a human is going to read the output in a terminal.

## Flags (CLI wrapper only — curl uses the body fields above)

| Flag | Description | Default |
|------|-------------|---------|
| `--limit N` | Max results to return | 10 |
| `--project NAME` | Target project (name, hash, or path) | Current directory |
| `--scores` | Show similarity scores | Hidden |
| `--json` | Output JSON | Human-readable |

## Example Output

```
## Search Results: "error handling patterns"

Found 5 matches:

📄 gotchas/gotcha-async-error-boundaries.md
   Async errors in React components need error boundaries at the right level
   Type: gotcha

📄 implementation/implementation-graceful-degradation.md
   Graceful degradation strategy when daemon is unreachable
   Type: implementation

📄 decisions/decision-error-reporting.md
   Use structured logging for errors, not console.error
   Type: decision
```

## Notes

- **Semantic search only** — Uses embeddings, not keyword matching
- **Workspace-aware** — Includes linked projects + user-scoped patterns (same scope as automatic retrieval)
- **All results** — Shows matches below injection floor (unlike automatic retrieval which filters)
- **Same ranking** — Uses the same similarity scoring as automatic injection
- **Natural queries work best** — "how to handle errors" retrieves better than just "errors"

## Related

- `/context-status` — See what's in the corpus (stats, not search)
- `/create-context` — Create new patterns (includes similarity check)
- `/context-stats` — See which patterns are actually being used
