---
name: token-overflow-protection-architecture
description: Three-layer statusline bridge architecture for preventing token overflow in long conversations
metadata:
  type: implementation
  tags: ["capacity", "statusline", "overflow", "github-17"]
---

# Token Overflow Protection (GitHub #17)

## Problem
Contextus injects context on every prompt but has no awareness of how full the conversation already is. In long sessions (>170K tokens), injection can push total past the 200K model limit, causing API 400 errors.

## Architecture: Statusline Bridge

Three-layer relay uses authoritative data from Claude Code's own context-window tracking:

```
Statusline (renders after each turn)
  → writes ~/.contextus/runtime/<session>.context-stats.json
    → query-hook.js reads file, includes contextStats in /query POST
      → daemon checks used_percentage before embedding/injection
```

## Key Design Decisions

1. **Percentages, not absolute tokens** — `used_percentage` is model-relative (harness computes it against active model's limit). Works for Sonnet, Opus, Haiku, any future model.

2. **1-turn staleness is conservative** — Stats reflect end-of-last-turn. Actual usage at decision time is slightly higher than reported, which errs toward more protection.

3. **Graduated degradation** (configurable thresholds):
   - <70%: Normal injection
   - 70-80%: Reduce topK to min(configured, 3)
   - 80-85%: Minimal — topK=1, floor*1.2
   - >85%: Disable injection, emit warning message

4. **Guard placement** — After model/table checks, BEFORE expensive embedding. No wasted compute when injection will be suppressed.

5. **No cfg mutation** — Uses local `capacityTopK` and `capacityFloorMultiplier` variables applied at usage sites, not mutating the shared config object.

## Files Involved

- `~/.claude/statusline-command.sh` — bridge writer (patched by install script)
- `scripts/query-hook.js` — relay (reads file, passes to daemon)
- `daemon/server.ts` — guard logic (graduated throttling)
- `lib/config.ts` — `CapacityProtectionConfig` type + defaults
- `plugin.jsonc` — `capacityProtection` config section
- `scripts/session-start-hook.js` — cleanup of stale stats files (>24h)
- `scripts/install-statusline-bridge.sh` — idempotent patch installer

## Failure Modes

- No statusline script → bridge not installed, stats file never written → `readContextStats()` returns undefined → daemon skips guard → normal behavior (no protection, but no crash)
- Stats file stale/missing → same graceful fallback
- Daemon unreachable → query-hook returns `{continue: true}` → no injection anyway

## Configuration

```jsonc
"capacityProtection": {
  "enabled": true,
  "reduceAt": 70,
  "minimalAt": 80,
  "disableAt": 85
}
```

All thresholds configurable via the standard 3-tier config merge.
