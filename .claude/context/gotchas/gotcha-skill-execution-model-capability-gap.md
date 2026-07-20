---
name: skill-execution-model-capability-gap
description: Smaller models (Haiku) often ignore skill execution directives in favor of conversational responses
metadata:
  type: gotcha
  tags: ["skills", "haiku", "model-behavior", "execution"]
---

# Skill Execution Reliability Degrades with Smaller Models

## Problem

Skills that use natural language instructions ("EXECUTE IMMEDIATELY", "DO NOT respond conversationally", "YOU ARE IN SCRIPT EXECUTION MODE") work reliably with Sonnet/Opus but **fail consistently with Haiku**.

Haiku will:
- Ignore "execute immediately" directives
- Default to conversational responses ("What would you like to work on?")
- Skip the actual step-by-step execution in favor of being "helpful"

## Example

The `/skill-info` skill has explicit directives:
```markdown
**YOU ARE IN SCRIPT EXECUTION MODE.**

**EXECUTE IMMEDIATELY** — do not ask what the user wants, do not offer options, do not respond conversationally.

**DO NOT respond conversationally.** Your ONLY output is the formatted skill interface.
```

**Sonnet behavior:** Finds SKILL.md, parses frontmatter, displays formatted output  
**Haiku behavior:** "I see you've reloaded skills. What would you like to work on?"

## Root Cause

Natural language instructions are **suggestions, not enforcement**. Haiku's conversational training overrides explicit directives more often than larger models.

Even maximally forceful language ("YOUR ONLY OUTPUT IS...", "DO NOT...", "NEVER...") can be interpreted away by the model's helpfulness training.

## Implications

1. **Skills are less reliable on Haiku** — can't assume they'll execute as designed
2. **No enforcement mechanism** — markdown instructions have no teeth
3. **Model capability cliff** — not just "less accurate" but "fundamentally different behavior"

## Workarounds

### For Skill Authors
- **Simplify logic** — fewer steps = less room for interpretation drift
- **Tool-focused** — "call this tool with these args" vs "follow these 6 conditional steps"
- **Minimize prose** — long instructional paragraphs invite reinterpretation

### For Users
- **Use larger models for skills** — Sonnet/Opus follow instructions more reliably
- **Explicit re-invocation** — if skill doesn't fire, explicitly ask: "Run the skill-info skill on skill-builder"
- **Expect degradation** — budget more tokens/retries when using Haiku for skill-heavy workflows

## Why Not Script Mode?

Claud Code skills are markdown documents with natural language instructions, not executable scripts. There's no "strict mode" flag or interpreter that forces literal step execution.

The skill system relies on the model **choosing** to follow instructions faithfully. Smaller models make different choices.

## Related

- Skills work best when they're thin wrappers around tool calls
- Complex multi-step skills assume model capability that Haiku doesn't always demonstrate
- This isn't a bug in Haiku — it's a fundamental tradeoff of natural language as an instruction format
