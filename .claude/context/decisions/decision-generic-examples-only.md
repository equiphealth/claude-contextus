---
name: generic-examples-only
description: Documentation, contexts, and examples must use only generic placeholders or contextus self-references, never other real project names
metadata:
  type: decision
  tags: [documentation, privacy, examples]
---

# Generic Examples Only

**Rule:** Any reference to project names or code in documentation, context files, or examples should only use generic placeholders or contextus self-references. Do not reference other real repos/projects on this machine.

## Why

- **Privacy:** Other projects may contain proprietary code, internal tool names, or patterns that shouldn't be shared publicly
- **Portability:** Generic examples are universally understandable; real project names are context-specific and confusing to external users
- **Dogfooding focus:** contextus self-references demonstrate the tool's capabilities on its own codebase

## How to Apply

**✅ DO:**
- `my-project`, `example-app`, `user-service` — generic placeholders
- `claude-contextus` — self-references (dogfooding)
- `~/src/my-app` — generic paths
- Anonymized patterns: "a mobile automation project", "an internal API"

**❌ DON'T:**
- Real project names from this machine
- Internal tool names from other codebases
- Paths that reveal other project structures
- File paths from other repos

## Where This Applies

- `docs/` — All documentation files
- `.claude/context/` — Context pattern examples
- `examples/` — Configuration and usage examples
- `README.md`, `DESIGN.md`, etc. — Any markdown files
- Commit messages (when referencing examples)

## Exceptions

- **Memory files** (`.claude/memory/` or `~/.claude/memory/`) — These are personal/private, not committed to public repo
- **Test fixtures** — Internal test data that won't be published
- **Inline code comments** — Only if referencing local implementation details

## When to Scrub

Before committing:
1. Search for known project names: `grep -r "automation\|my-equip" docs/ .claude/context/ examples/`
2. Replace with generic equivalents
3. Commit the sanitized version

During code review:
- Flag any real project references in docs/context/examples
- Suggest generic replacements

## Related

- [[project-pr-checklist]] — Add "scrub real project names" as pre-commit check
- Privacy principle: public artifacts should be universally applicable
