---
name: expansion-providers
description: Query expansion provider options (Ollama vs Bedrock), performance characteristics, cold-start gotcha, and config guidance
metadata:
  type: implementation
  tags: [expansion, ollama, bedrock, performance, configuration]
---

# Expansion Provider Performance

Query expansion generates alternate phrasings via an LLM when initial search scores poorly.

## Provider Comparison (measured 2026-06-18)

| Provider | Cold | Warm | Consistency | Cost |
|----------|------|------|-------------|------|
| qwen2.5:3b (Ollama) | 9.5s | 443ms | Variable — Ollama unloads idle models | Free (local) |
| Haiku 4.5 (Bedrock) | n/a | 2.2s | Consistent — no cold-start | AWS pay-per-use |

## Critical Gotcha: Ollama Cold Start

Ollama unloads models after idle time (~5min default). First expansion call after unload takes 9.5s to reload qwen2.5:3b into memory. With `timeoutMs: 5000`, this **always times out** — expansion silently fails and returns empty variants.

**Detection:** Every query takes exactly ~5050ms but logs show "Expansion skipped" or no expansion output.

**Mitigation:** Pre-warm qwen2.5:3b at SessionStart (not yet implemented — see V2_ROADMAP.md Track C).

## Configuration

In `.claude/contextus.jsonc` under `expansion`:

```jsonc
{
  "expansion": {
    "mode": "adaptive",        // adaptive | always | off
    "provider": "ollama",      // primary provider
    "model": "qwen2.5:3b",    // local, fast when warm
    "fallbackProvider": "bedrock",  // fires on fast primary failure
    "fallbackModel": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "expansionThreshold": 0.55, // adaptive fires when bestScore < this
    "maxVariants": 3,          // alternate phrasings generated
    "temperature": 0.7,        // higher = more diverse
    "timeoutMs": 5000          // shared budget (primary + fallback)
  }
}
```

## Mode Selection Guide

- **adaptive** (recommended): Only fires when initial search scores below threshold. Most queries score > 0.55 so expansion rarely triggers. Best latency profile.
- **always**: Every query pays expansion cost. Only viable if Ollama is reliably warm (pre-warmed). Do NOT use without pre-warm — causes 5s timeout on every query.
- **off**: No expansion. Fastest, but misses synonym/paraphrase queries.

## Fallback Chain

Primary fails fast (connection refused, <500ms) → fallback fires with remaining time budget. Slow failures (timeout exhausted) do NOT fall back — avoids piling latency.

Example: Ollama times out at 5000ms → no time budget remains → Bedrock never fires. This is why `mode: "always"` + cold Ollama = total expansion failure.

## When Expansion Helps

- Domain synonyms: "vector model" ≠ "embedding model" in embedding space
- Short fragments: mean-pooling dilutes 3-word phrases
- Weak verb synonyms: "powers" vs "uses" are far apart in nomic-embed-text
- Measured: 3/7 synonym test queries fail entirely without expansion
