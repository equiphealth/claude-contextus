# Injection Templates

Control how retrieved patterns are formatted before injection into Claude's context.

## How to Use

Copy any template to your project or user config location:

```bash
# Per-project (git-committed, shared with team)
cp templates/default.md .claude/contextus-template.md

# Per-user (global, all projects)
cp templates/minimal.md ~/.contextus/contextus-template.md
```

The daemon checks for templates in this order:
1. `<project>/.claude/contextus-template.md` — project-specific
2. `~/.contextus/contextus-template.md` — user-global
3. Built-in default (same as `templates/default.md`)

Edit the file to change how injected context looks. Changes take effect on the next query (no daemon restart needed — the file is re-read on mtime change).

## Available Variables

### Top-level
| Variable | Description |
|----------|-------------|
| `{{count}}` | Number of patterns being injected |

### Inside `{{#each patterns}}...{{/each}}`
| Variable | Description |
|----------|-------------|
| `{{filename}}` | Pattern file name (e.g. `decision-daemon-from-dist.md`) |
| `{{heading}}` | Section heading within the file (empty if whole-file match) |
| `{{body}}` | The pattern content (markdown) |
| `{{type}}` | Frontmatter type: decision, gotcha, reference, etc. |
| `{{source}}` | Source pack: projectMemory, projectDocs, userMemory, userDocs |
| `{{similarity}}` | Cosine similarity score (e.g. `0.82`) |
| `{{hits}}` | Number of times this pattern has been retrieved before |

### Conditionals
| Syntax | Description |
|--------|-------------|
| `{{#heading}}...{{/heading}}` | Only renders if heading is non-empty |
| `{{#hits}}...{{/hits}}` | Only renders if hits > 0 |
| `{{#type}}...{{/type}}` | Only renders if type is set |

## Sample Templates

| File | Style | Best For |
|------|-------|----------|
| `default.md` | Headings + type badge + separator | General use |
| `minimal.md` | Just filename + body | Lowest token cost |
| `debug.md` | All metadata visible | Debugging retrieval quality |
| `xml-tagged.md` | XML-style tags | If your model attends better to XML structure |

## Tips

- The `[contextus ...]` header helps Claude distinguish injected context from user text
- Use `---` separators between patterns for visual scanning in paranoid logs
- Shorter templates = fewer tokens spent on formatting overhead
- The XML-tagged style can improve attention in some models (structured boundaries)
- Hit count shows which patterns have proven useful — consider hiding it for cleaner output
