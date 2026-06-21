---
name: warmup-failure-cascade
description: Daemon warmup failure is permanent — config changes don't trigger retry, leaving the daemon stuck until manual kill
metadata:
  type: gotcha
  tags: [daemon, warmup, resilience, provider-switch]
---

# Warmup Failure Cascade

When the daemon's embedding model warmup fails (network error, blocked domain, wrong provider), it exhausts retries and permanently sets `modelLoaded = false`. This cascades:

1. All `/query` requests short-circuit → no context injection
2. All `/reconcile` requests refuse to embed → corpus never builds
3. Config changes (e.g. switching from `transformers` to `ollama`) have NO effect — the daemon doesn't re-read config or retry warmup
4. User sees silent failure (no injection, no error) or misleading SessionStart message

## Observed scenario (2026-06-21)

1. `plugin.jsonc` temporarily set to `provider: "transformers"`
2. Daemon spawned, attempted HF download → blocked by Cloudflare Gateway
3. Retried 5x with exponential backoff (10s→160s) → exhausted → gave up
4. User reverted config to `provider: "ollama"` (which works fine)
5. Daemon stayed stuck — never re-attempted warmup with new config
6. All sessions silently got zero injection for 3+ hours

## Compounding issue: meta mismatch

Even after killing the daemon, the corpus meta (`contextus.meta.json`) recorded `provider: "transformers"` and `embeddingModel: "nomic-ai/nomic-embed-text-v1.5"`. The daemon's model-mismatch check would STILL block queries because the ollama model name is `"nomic-embed-text"` (shorter string). Required manual meta correction + re-embed.

## Fixes needed (resilience improvements)

| Fix | Effort | Impact |
|-----|--------|--------|
| Watch config mtime, retry warmup on change | Medium | Eliminates the stuck state |
| Self-terminate after N min in failed state | Low | SessionStart respawns fresh |
| Normalize model names (canonical equivalence) | Low | Prevents false mismatch on same model |
| SessionStart reports actual daemon state (not just provider reachability) | Low | User sees "warmup failed" not "ollama unreachable" |
| `/contextus-doctor` — diagnose + auto-fix | Medium | One-command recovery |

## Current workaround

```bash
kill $(cat ~/.contextus/runtime/daemon.pid) 2>/dev/null
pnpm embed   # re-embeds with current config, fixes meta
# Daemon respawns on next session start
```

## Related

- `gotcha-daemon-restart-on-upgrade.md` — code upgrades also need daemon kill
- `gotcha-embedding-provider-switch.md` — switching providers needs re-embed
- `tradeoff-embedding-provider-deployment.md` — why provider switching happens
