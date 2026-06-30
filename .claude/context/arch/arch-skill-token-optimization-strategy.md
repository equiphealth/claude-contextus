---
name: skill-token-optimization-strategy
description: Skill file architecture — slim SKILL.md files with reference docs in docs/skills/ to minimize system prompt overhead
metadata:
  type: arch
  tags: ["skills", "performance", "token-optimization"]
---

# Skill Token Optimization Architecture

## Problem
Claude Code loads ALL skill SKILL.md files into the system prompt on every session. The original contextus skills totaled ~12,700 tokens:
- `contextus-setup`: 628 lines (3,773 tokens)
- `context-calibrate`: 402 lines (4,095 tokens)
- `context-stats`: 117 lines (1,081 tokens)
- 14 duplicate alias skills (ctx-*) adding ~400 tokens
- 17 other skills ranging 50-250 lines each

This ate significant context budget before any user prompt.

## Solution
**Two-part optimization:**

1. **Move reference material to `docs/skills/`** — Implementation details, flag tables, examples, interpretation guides live in docs/ (loaded on-demand during skill execution, NOT in system prompt)
2. **Slim SKILL.md to dispatch logic only** — When to use, 1-2 sentence summary, pointer to docs/
3. **Keep only high-traffic aliases** — Deleted 6 low-use ctx-* aliases (archive, audit, merge, review, search, setup), kept 8 primary ones (status, stats, calibrate, doctor, create, watch, migrate, tag)

## Results
- **9,300 tokens saved** (~73% reduction)
- Registry: ~12,700 → ~3,400 tokens
- 30 skills + 8 aliases (down from 34 total)
- No functionality lost — full docs available when skill executes

## Pattern
**Slim SKILL.md template:**
```markdown
---
name: skill-name
description: One-line topical signal
---

# skill-name

**Summary** — one sentence what it does.

## When to use
- Trigger condition 1
- Trigger condition 2

## Instructions
Core dispatch logic (what to run, how to present results).

See [docs/skills/skill-name.md](../../docs/skills/skill-name.md) for:
- Implementation details
- Flags and options
- Examples and edge cases
```

Target: 10-40 lines per SKILL.md (down from 50-628).

## Why This Works
Claude Code skill registry is eager-loaded (all files parsed at session start). Moving 90% of content to docs/ means:
- System prompt stays lean
- Skills remain fully documented (Read the doc during execution)
- Aliases cost ~6 lines instead of ~30-100

## When NOT to Slim
- Skills with <20 lines already (add-patterns, etc.) — no savings
- Critical decision trees that must be in-prompt (none identified yet)

## Maintenance
When adding new skills:
1. Write full guide in `docs/skills/<name>.md`
2. Create slim `skills/<name>/SKILL.md` following template
3. If adding an alias, keep it ≤10 lines (just frontmatter + pointer to canonical skill)
