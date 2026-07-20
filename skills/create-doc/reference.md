---
name: create-doc
description: Create documentation in docs/ with the same frontmatter schema as context files — name, description, metadata.type, metadata.tags. Improves retrieval quality and audit coverage.
---

# Create Documentation

Create docs that embed well. Same frontmatter as `.claude/context/` files — the embed
pipeline (`loadContext`) already parses it from docs, so adding frontmatter gives them
proper `name`, `description`, `type`, and `tags` for re-ranking and audit.

## Configuration

Respects `config.docs.requireFrontmatter` in plugin.json (set during `/contextus-setup`):

- **`true`** → always adds full frontmatter (default behavior of this skill)
- **`false`** → ask the user before adding frontmatter: "Your project doesn't require
  frontmatter on docs. Add it anyway for better retrieval? [Yes / No]"
  If they say no, create the doc without frontmatter (just a heading + body).

## When to Use

- Writing guides, references, or specs in `docs/`
- The user says "document this" or "create a doc for..."
- After `/investigation-complete` when the finding deserves a full write-up

## Frontmatter Schema (MUST match context files)

```markdown
---
name: <kebab-slug>
description: <one line — strong topical signal, gets embedded as part of the first chunk>
metadata:
  type: <one of: reference, arch, decision, implementation, schema, api, phase, project, security, perf>
  tags: [topic1, topic2]
---

<body>
```

**Most docs are `reference` or `arch` type.** Pick by what question the doc answers:
- "How does X work?" → `reference`
- "What's the architecture?" → `arch`
- "What did we decide?" → `decision`
- "How do I build/run X?" → `implementation`
- "What's the API surface?" → `api` or `schema`

## Naming Convention

```
docs/<slug>.md
```

Docs do NOT use the `<type>-<slug>.md` prefix that context files use. The embed
pipeline exempts docs from the prefix↔type gate. Use a descriptive kebab-case filename.

## What Makes a Good Doc vs a Good Context File

| | Context file | Doc |
|---|---|---|
| Length | 1-3 paragraphs (focused pattern) | Multi-section (comprehensive) |
| Purpose | Quick injection per-prompt | Deep reference on demand |
| Location | `.claude/context/<category>/` | `docs/` |
| Audience | Claude (ambient retrieval) | Claude + humans |

## Workflow

1. Create the file in `docs/` with proper frontmatter
2. Write the body (markdown, code blocks, tables — whatever fits)
3. Add to `docs/DOCS.md` index if it exists
4. Re-embed: the full embed picks up docs automatically

```bash
TSX=~/src/claude-contextus/node_modules/.bin/tsx
$TSX ~/src/claude-contextus/scripts/embed-contexts.ts
```

## Example

```markdown
---
name: daemon-lifecycle
description: How the contextus daemon starts, stops, recovers from crashes, and manages idle shutdown
metadata:
  type: arch
  tags: [daemon, lifecycle, recovery, idle-timeout]
---

# Daemon Lifecycle

The daemon auto-starts on first retrieval request and shuts down after idle timeout...
```

## Related

- `/create-context` — short patterns for ambient injection
- `/audit-context` — validates frontmatter on both context AND docs
- `/rebuild-embeddings` — re-embed after adding docs
