---
name: docs-as-retrieval-incentive
description: Tags and categories in docs create a behavioral nudge — engineers write more structured docs when retrieval rewards it
metadata:
  type: project
---

## Insight: Retrieval as a Documentation Incentive

When docs have tags and categories that feed into retrieval scoring, engineers are incentivized to write docs that are more structured and retrieval-friendly. The system creates a positive feedback loop:

1. Engineer writes a doc with clear tags and a good description
2. Contextus retrieves it more accurately (better semantic signal from metadata)
3. The doc actually gets USED in sessions (visible in usage-rate)
4. Engineer sees the value and writes more structured docs

This is the opposite of traditional wikis where docs are written and forgotten. Contextus makes docs load-bearing — they directly influence AI behavior in every session. That visibility changes how people think about documentation.

## Future: Graduated Structure

Docs can start free-form (target: doc, no frontmatter) and graduate to structured (add tags, categories, description) as they prove useful. The /capture endpoint supports both modes, making the transition frictionless. A doc that keeps getting retrieved earns its structure.

## Implication for Adoption

When pitching contextus to a team: the documentation quality improvement is a second-order benefit beyond the direct AI context delivery. Teams that adopt contextus tend to write better docs because the system makes doc quality visible and rewarded.
