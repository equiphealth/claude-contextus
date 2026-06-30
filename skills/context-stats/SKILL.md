---
name: context-stats
description: Usage analytics for injected context — show what's working, what's noisy, what's stale
---

# context-stats

**Usage analytics** — aggregates eval data to show most useful, noisy, stale, and never-retrieved patterns.

## When to use

- User asks for usage statistics, pattern analytics, or corpus health
- Before archiving or promoting patterns
- Regular maintenance (monthly suggested)

## Instructions

Execute silently. One sentence intro, then run commands without narration. Present results directly.


When invoked:
1. Run the context-stats CLI (see implementation guide)
2. Present output to user
3. Suggest follow-up actions for noisy/stale patterns:
   - **Noisy**: `/context-review --filter noisy`
   - **Stale**: `/context-archive --stale`
   - **Never retrieved**: Check if pattern needs better keywords

## Implementation

See [./reference.md](./reference.md) for:
- CLI command and discovery script
- All flags and options
- Result interpretation guide
- Examples and troubleshooting
