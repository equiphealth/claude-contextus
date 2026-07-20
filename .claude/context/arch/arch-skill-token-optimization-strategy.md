---
name: skill-token-optimization-strategy
description: Skill file architecture — slim SKILL.md with reference docs, but triggers MUST stay in SKILL.md
metadata:
  type: arch
  tags: ["skills", "performance", "token-optimization"]
---

# Skill Token Optimization Architecture

## Problem
Claude Code loads ALL skill SKILL.md files into the system prompt on every session. Heavy skills eat context budget.

## Solution: Two-File Pattern

**SKILL.md (eager-loaded, in system prompt):**
- Frontmatter with `name` and `description`
- **When to use** — Trigger conditions (CRITICAL: Claude needs this BEFORE invocation)
- Brief summary (1-2 sentences)
- Instructions (execution steps or pointer to reference.md)

Target: 15-40 lines

**reference.md (loaded on-demand during execution):**
- Implementation details
- Flags, options, examples
- Result interpretation
- Troubleshooting
- Edge cases

Can be 100+ lines — not counted against system prompt.

## Critical Gotcha

**"When to use" MUST be in SKILL.md**, not reference.md.

**Why**: Claude decides whether to invoke a skill based on trigger conditions. If those are in reference.md, they're not loaded until AFTER the skill executes. Catch-22.

**Bad example:**
```markdown
# SKILL.md
## When to use
See [./reference.md](./reference.md) for when to invoke this skill
```
❌ Claude can't see the triggers, won't invoke the skill.

**Good example:**
```markdown
# SKILL.md
## When to use
- User asks for status/health check
- Something feels off with retrieval
- After config changes

## Instructions
See [./reference.md](./reference.md) for implementation details.
```
✅ Claude sees triggers, knows when to invoke.

## Template

```markdown
---
name: skill-name
description: One-line summary (shown in autocomplete)
---

# skill-name

**Summary** — one sentence what it does.

## When to use
- Trigger condition 1
- Trigger condition 2
- Trigger condition 3

## Instructions
[Brief execution steps, or:]
See [./reference.md](./reference.md) for:
- Implementation details
- Flags and options
- Examples and edge cases
```

## What We Achieved

**Before:** 34 skills, ~12,700 tokens
**After:** 30 skills, ~3,400 tokens (73% reduction)

**Biggest savings:**
- `contextus-setup`: 628 → 43 lines
- `context-calibrate`: 402 → 34 lines
- `context-stats`: 117 → 32 lines

## When NOT to Slim

- Skills already <20 lines (no savings)
- Critical decision trees that must be in-prompt (rare)
- Trigger conditions are complex and need examples inline

## Maintenance

When adding new skills:
1. Write full guide in `skills/<name>/reference.md`
2. Write slim `skills/<name>/SKILL.md` with triggers + pointer
3. Verify: Can Claude decide to invoke this skill from SKILL.md alone?

## Related Patterns

- `reference-skill-execution-patterns.md` — Silent vs conversational
- `tradeoff-skill-alias-context-cost-tradeoff.md` — Why aliases matter
