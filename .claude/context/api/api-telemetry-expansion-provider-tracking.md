---
name: telemetry-expansion-provider-tracking
description: Track which LLM provider (ollama/bedrock/anthropic) handles query expansion, not hardcode fallback chains
metadata:
  type: api
  tags: [transcript-mined]
---

When instrumenting query expansion telemetry, track the provider used (ollama, bedrock, anthropic, custom) separately from expansion mode (adaptive/always/off). Don't assume bedrock is the only fallback—different users configure different providers. Collect: (1) primary expansion provider, (2) fallback provider used (if different), (3) fallback frequency. This reveals provider preferences and fallback patterns without baking in specific provider assumptions.
