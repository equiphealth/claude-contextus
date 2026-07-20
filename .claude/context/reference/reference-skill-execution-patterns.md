---
name: skill-execution-patterns
description: Two skill execution patterns: silent system commands vs conversational wizards
metadata:
  type: reference
  tags: ["skills", "ux", "patterns"]
---

# Skill Execution Patterns

## Two Patterns

### Silent System Commands
**For**: Status checks, analytics, rebuilds, diagnostics

**Pattern:**
- One intro sentence stating what you're doing
- Silent tool calls (no narration between calls)
- Present results directly

**Examples:**
- `/context-stats` — "Checking usage analytics." → [reads, runs CLI] → present data
- `/context-status` — "Getting daemon status." → [queries] → show status
- `/context-calibrate` — "Running floor calibration." → [runs analysis] → show recommendations
- `/rebuild-embeddings` — "Rebuilding corpus." → [rebuilds] → "Done. N files embedded."
- `/context-doctor` — "Running diagnostics." → [checks] → list findings

**What NOT to do:**
- "I'll check the reference guide" (just do it)
- "Now I'll run the command" (narrating the obvious)
- "Let me get a more complete view" (execute, don't announce)

### Conversational Wizards
**For**: Setup, migration, interactive curation, configuration

**Pattern:**
- Explain options and implications
- Ask questions, wait for answers
- Preview changes before applying
- Guide through multi-step flows
- Narration is valuable here

**Examples:**
- `/contextus-setup` — "How would you like to set this up?" → explain tracks → guide choices → confirm
- `/migrate-memory` — "Found N memory files. Here's what I'd convert..." → preview → ask to proceed
- `/context-review` — Interactive filtering, presenting candidates, asking keep/archive/rewrite
- `/configure` — "Current config: ... What would you like to change?"

**Why conversational works:**
- User needs to understand tradeoffs before deciding
- Changes are potentially destructive (setup writes config, migration moves files)
- Flow has genuine decision points, not just execution steps

## How to Choose

**Ask: Does the user need to decide something, or just see a result?**

- **Just see result** → Silent system command
- **Needs to decide** → Conversational wizard

**Edge cases:**
- `/context-calibrate` with `--apply` — silent until the recommendation, then conversational to confirm the config write
- `/context-search` — silent (just show matches), unless user asks "should I use this pattern?" then switch to advisory

## Implementation in SKILL.md

**Silent skills** should include:
```markdown
## Instructions

One sentence intro, then execute silently. Present results with no narration.
```

**Conversational skills** should include:
```markdown
## Instructions

Guide the user through options. Explain tradeoffs. Preview changes. Confirm before writing.
```

## Token Impact

This distinction doesn't affect SKILL.md token cost (both are ~10-40 lines), but clarifies execution expectations so Claude doesn't over-narrate system commands.
