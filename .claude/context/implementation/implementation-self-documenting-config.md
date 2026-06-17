---
name: self-documenting-config
description: .claude/contextus.json serves as reference template showing all config options
metadata:
  type: implementation
  tags: [config, self-documentation, developer-experience]
---

# Self-Documenting Config Pattern

`.claude/contextus.json` in the contextus repo serves dual purposes:

1. **Reference template** — demonstrates ALL available config options
2. **Working override** — but only when contextus itself needs a project-specific override

## Rule

When adding new config to `lib/config.ts` or `plugin.json`, update `.claude/contextus.json` to show the new option with its default value and inline documentation.

## Why

This repo is self-documenting. Users look at `.claude/contextus.json` to see what's configurable. If we add `expansion.timeoutMs` but don't update the local override, users won't discover it.

## How to Apply

**After adding config:**
1. Add the new field to `.claude/contextus.json` with default value
2. Add `_note` if the option needs explanation
3. Set the value to the plugin.json default (not a contextus-specific override)

**Exception:** If contextus itself needs a different value (e.g., higher `injectionFloor` for testing), that's fine — but document WHY in a note.

## Example

When expansion config was added in PR #2:
- Added `expansion` object to `.claude/contextus.json`
- Included all fields: mode, provider, models, threshold, variants, temperature, timeout
- Used plugin.json defaults (not contextus-specific overrides)
- Added `_note` explaining what expansion does

## Related

- `dev/SELF_DOCUMENTATION.md` — broader self-documenting patterns
- `plugin.json` — the global defaults (tier 1)
- `lib/config.ts` — the TypeScript source of truth
