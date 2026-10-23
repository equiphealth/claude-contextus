---
name: self-documenting-config
description: >-
  All config locations that must stay in sync when adding new options -- plus a
  worked example (stopGate) of an option deliberately outside lib/config.ts
  entirely, and why adding it there would be decorative, not a fix
metadata:
  type: implementation
  tags:
    - config
    - self-documentation
    - developer-experience
    - checklist
---

# Config Update Checklist

When adding or modifying config options, ALL of these locations must be updated:

| File | Role | Format |
|------|------|--------|
| `plugin.jsonc` | Runtime defaults (tier 1, lowest precedence) | JSONC with comments |
| `examples/contextus.jsonc` | Annotated reference users copy from | JSONC, heavily commented |
| `.claude/contextus.jsonc` | Project override (tier 3, highest precedence) | JSONC |
| `scripts/awareness-hook.js` | Reads config directly (plain JS, no typed config) | JS with `captureConfig()` |

## Rule

When adding new config to `plugin.jsonc`, update ALL locations above. The awareness hook reads `contextCapture` options directly from JSON files (not via `lib/config.ts`), so it needs separate updates.

## Why

Config is split across tiers for precedence (plugin defaults → user global → project override). Users discover options by reading `examples/contextus.jsonc`. The awareness hook runs as plain JS outside the TS build. Missing any one location means the option either doesn't work, isn't discoverable, or has wrong defaults.

## How to Apply

**After adding config:**
1. Add to `plugin.jsonc` under `config {}` with inline comment
2. Add to `examples/contextus.jsonc` with explanatory comment
3. Add to `.claude/contextus.jsonc` (dogfood — set to project-appropriate value)
4. If the hook reads it: update `captureConfig()` in `scripts/awareness-hook.js`
5. If it's typed config: update `lib/config.ts` types

**Exception:** If contextus itself needs a different value (e.g., higher `injectionFloor` for testing), that's fine — but document WHY in a comment.

## Example

When `captureFooter` was added (PR #12):
- Added to `plugin.jsonc` `contextCapture` block with comment
- Added to `examples/contextus.jsonc` with `// "always" = emit... | "off" = no...` annotation
- Added to `.claude/contextus.jsonc` as `"captureFooter": "always"`
- Updated `captureConfig()` in awareness hook to read it with precedence

## Worked example: an option with NO lib/config.ts entry at all (by design)

`contextCapture.stopGate` (PR #88, the capture-enforcement stop hook) is the sharpest
case of rule 5's "if it's typed config" caveat: the entire `contextCapture` block —
`enabled`, `mode`, `captureFooter`, `stopGate` — has **no interface or DEFAULTS entry
in `lib/config.ts` at all**. `scripts/capture-gate-hook.js` and `scripts/awareness-hook.js`
both parse the raw JSONC files directly in plain JS (`stopGateEnabled()` in
capture-gate-hook.js, `captureConfig()` in awareness-hook.js), each with its own inline
hardcoded fallback — by design, so these hooks start fast with no TS build dependency.

**Don't "fix" this by adding `contextCapture` to `lib/config.ts` DEFAULTS.** Nothing in
the stop-hook code path consults `lib/config.ts`, so a DEFAULTS entry there would be
decorative — a fourth place a value could live, disconnected from the code that actually
reads it, which is exactly the failure pattern behind `injectionFloor` shipping three
disagreeing values across `plugin.jsonc` (0.725), `examples/contextus.jsonc` (0.45 claimed),
and `lib/config.ts` DEFAULTS (0.35). If a future option needs to be read by one of the
plain-JS hooks, follow the `stopGate` precedent (project-tier JSONC > plugin-tier JSONC,
parsed inline, no `lib/config.ts` involvement) rather than introducing a typed entry
nothing will read.

## Related

- `dev/SELF_DOCUMENTATION.md` — broader self-documenting patterns
- `plugin.jsonc` — the global defaults (tier 1)
- `examples/contextus.jsonc` — the user-facing reference
- `lib/config.ts` — the TypeScript source of truth (for typed config only)

