---
name: skill-alias-context-cost-tradeoff
description: Skill aliases cost context in Claude Code (no native aliasing primitive); slim SKILL.md files are the best available workaround
metadata:
  type: tradeoff
  tags: ["skills", "performance", "claude-code-limitations"]
---

# Skill Alias Context Cost Tradeoff

## Problem

Claude Code's skill system loads ALL `skills/*/SKILL.md` files into the system prompt at session start. Each alias requires its own SKILL.md file, even if it's just a pointer to the canonical skill.

**Cost per alias:**
- Minimum: ~10 lines (frontmatter + pointer)
- Tokens: ~40-50 tokens per alias
- 8 aliases = ~320-400 tokens

## Why Aliases Matter

Ergonomics for high-frequency commands:
- `/ctx-status` is 31% shorter than `/context-status` (11 vs 16 chars)
- Muscle memory for power users
- Convention: short aliases are standard (`k` for `kubectl`, `g` for `git`)

## Current Best Practice

**Ultra-slim alias SKILL.md:**
```markdown
---
name: ctx-status
description: Alias for /context-status
---

See [/context-status](../context-status/SKILL.md).
```

5-6 lines total. Can't go lower without losing the frontmatter that Claude Code's skill loader requires.

## Why Not Symlinks?

```bash
ln -s context-status/SKILL.md ctx-status/SKILL.md
```

Claude Code's skill loader likely reads the directory name as the skill name, so symlinks probably won't work. (Untested but low confidence.)

## What We'd Want (Not Currently Supported)

**Native aliasing in skill frontmatter:**
```yaml
# skills/context-status/SKILL.md
---
name: context-status
aliases: [ctx-status, status]
---
```

The runtime would register all three invocation names but only load one SKILL.md. Zero context overhead for aliases.

## Decision

**Keep slim aliases** for high-traffic skills. The cost is acceptably small:
- 8 aliases × 10 lines = 80 lines (~320 tokens)
- 3% of the 9,300 token savings from skill refactoring (PR #29)
- Ergonomic value for power users outweighs marginal token cost

**Delete aliases only if:**
1. Usage data shows <10% invocation rate vs canonical skill, OR
2. Context budget becomes constrained again (unlikely after refactor)

## Product Feedback (Upstream)

This is a limitation of Claude Code's skill system, not contextus. Legitimate feature request:

> **Native alias support** — Allow `aliases: [...]` in skill frontmatter so multiple invocation names map to one SKILL.md without duplicating files.

**Where to suggest:**
- Claude Code Discord (developer channels)
- Anthropic feedback channels
- Direct contact if available

## Alternative: Multiplexer Pattern (Not Recommended)

A single `/ctx` skill that routes based on subcommand:
```
/ctx status  → execute /context-status
/ctx stats   → execute /context-stats
```

**Why not:**
- Different UX (space instead of dash)
- Doesn't show up in autocomplete
- Confusing for users expecting `/ctx-status`

Not worth the UX friction.

## Related Patterns

- `arch-skill-token-optimization-strategy.md` — The slim SKILL.md approach that enables low-cost aliases
- `reference-skill-execution-patterns.md` — Execution patterns (orthogonal to aliasing)

## When to Revisit

1. **After 3-6 months:** Analyze skill invocation logs to see which aliases get real usage
2. **If Claude Code adds native aliasing:** Migrate immediately to frontmatter-based aliases
3. **If context budget becomes constrained:** Re-evaluate whether all 8 aliases are worth keeping
