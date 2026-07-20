---
name: skill-testing-execution-philosophy
description: Skills must execute fully during testing with minimal narration - show real results, not summaries
metadata:
  type: reference
  tags: ["skills", "testing", "execution"]
---

# Skill Testing & Execution Philosophy

## Core Principle

When a skill is invoked (whether for real work or testing), **always execute it completely and show actual results**.

## What This Means

### Always Execute Fully

- Run all commands the skill requires
- Query actual APIs, read real files, run real diagnostics
- Don't skip steps or summarize "what would happen"
- Don't say "the skill would show X" — actually show X

**Bad:**
```
The `/context-status` skill would query the daemon and show:
- Corpus size
- Recent activity
- Configuration
```

**Good:**
```bash
curl -s 127.0.0.1:37800/health | jq
# [actual output displayed]
```

### Minimal Narration

- Present results directly with minimal descriptive overhead
- One intro sentence if needed, then execute
- Let the output speak for itself
- Only add explanation when context is genuinely needed

**Bad:**
```
I'll now run the context-status skill to check the daemon health.
This will query the /health endpoint and show...
[runs command]
As you can see from the output above, the daemon is healthy...
```

**Good:**
```
[runs command]
[shows output]
```

Or with minimal context:
```
Checking daemon health.
[runs command]
[shows output]
```

## Why This Matters

1. **Builds confidence** — User sees the skill actually works, not just a description
2. **Catches bugs** — Real execution reveals issues summaries would miss
3. **Shows real data** — Actual corpus stats, actual error messages, actual performance
4. **Clean UX** — Results without unnecessary chatter

## When Context IS Needed

 Add brief explanation when:
- The output is cryptic or needs interpretation
- Multiple steps are happening and user needs orientation
- An error occurred and needs diagnosis
- Results are unexpected and need clarification

But default to: execute → show results → minimal wrap-up.

## Applies To

- **Testing during development** — "Let me verify `/ctx` works" → actually run it, show real output
- **User requests** — "/context-doctor" → run full diagnostics, show actual findings
- **Demonstrations** — "Here's how `/ctx status` works" → show it working with real data

## Related Patterns

- `reference-skill-execution-patterns.md` — Silent vs conversational skills
- Skills with "Execute silently" in their SKILL.md follow this pattern by default
