---
name: hook-timeout-vs-query-latency
description: UserPromptSubmit hook times out at 5s but daemon queries take ~5050ms, causing injection delivery failures
metadata:
  type: gotcha
  tags: [hooks, timeout, performance, injection, daemon]
---

# Hook Timeout vs Query Latency Gotcha

**Symptom:** Daemon logs show successful retrieval with high scores (1.0, 0.98, 0.96) but Claude receives no `[contextus — ...]` injection blocks. Hook returns `{"continue": true}` instead of the full daemon response.

**Root Cause:** **Hook timeout (5000ms) is exceeded by daemon query latency (~5050ms)**. The fetch times out 50ms before the daemon responds, causing the hook to catch the timeout error and return graceful degradation `{"continue": true}`.

## Evidence

**Daemon logs:**
```
INFO Retrieved 5 patterns (scores=1.00/0.98/0.96/0.94/0.49, latency=5056ms, dropped=0, project=claude-contextus)
```

**Hook test (with 5s timeout):**
```bash
echo '{"prompt":"test","cwd":"..."}' | node scripts/query-hook.js
# → {"continue":true}  (no hookSpecificOutput)
```

**Direct daemon test:**
```bash
curl -X POST http://localhost:37800/query -d '{"project":"claude-contextus","prompt":"test"}'
# → {"continue":true,"hookSpecificOutput":{...}}  (full response!)
```

**Timeout trace:**
```javascript
const res = await fetch(`${BASE_URL}/query`, {
  signal: AbortSignal.timeout(5000)  // 5000ms
});
// Daemon responds at 5056ms → AbortError: The operation was aborted due to timeout
```

## Why Queries Take 5+ Seconds

**Corpus size:** 1207 chunks (92 files) across project context + docs + user context/docs

**LanceDB search overhead:**
- Vector search over 1207 768-dim embeddings
- Hybrid search adds BM25 keyword scan (parallel, but adds latency)
- Query expansion (adaptive mode) can add 100-400ms when it fires

**Measured latencies from logs:**
- Pure semantic: 5046-5068ms
- With expansion: 5400-5438ms
- Keyword fallback: 26-32ms (fast, but only fires when embedding fails)

## Why 50ms Matters

The timeout is checked **before** processing the response. Even 50ms over causes:
1. Fetch throws `AbortError`
2. Hook catches error (line 62: `catch { ... }`)
3. Hook returns `{"continue": true}` (graceful degradation)
4. Daemon's response arrives but hook has already exited
5. Claude Code receives no injection

## Impact

- **Production injection failure rate:** ~100% on queries that take >5s
- **Silent degradation:** No error shown to user, just missing context
- **Confusing logs:** Daemon shows "Retrieved 5 patterns" but nothing injects
- **Worse on large corpuses:** More files = longer search = higher timeout rate

## Detection

**Check if timeout is the issue:**

1. Run query manually:
```bash
time (echo '{"prompt":"test","cwd":"..."}' | node scripts/query-hook.js)
# If >5s and returns {"continue":true}, timeout is firing
```

2. Check daemon logs for latency:
```bash
grep "INFO Retrieved" ~/.contextus/logs/daemon.log | tail -5
# Look for latency_ms values
```

3. Test daemon directly:
```bash
curl -X POST http://localhost:37800/query -d '{"project":"claude-contextus","prompt":"test"}'
# If this returns hookSpecificOutput but hook doesn't, timeout is confirmed
```

## Solutions (Options)

### Option 1: Increase Timeouts (Quick Fix)

**Change:**
- `hooks/hooks.json` line 22: `"timeout": 5000` → `10000`
- `scripts/query-hook.js` line 57: `AbortSignal.timeout(5000)` → `10000`

**Pros:** Immediate fix, handles current corpus size
**Cons:** Doesn't scale, 10s hook delay is noticeable to users

### Option 2: Optimize Query Performance (Proper Fix)

**Reduce corpus size:**
- Remove low-value docs (e.g., auto-generated files)
- Split large docs into separate files
- Use shorter chunks (less to scan)

**Optimize search:**
- Cache embeddings (already done)
- Index LanceDB table (if supported)
- Reduce topK (fetch fewer candidates)

**Disable expensive features:**
- Set `expansion.mode: "off"` (saves 100-400ms when it fires)
- Set `retrieval.hybrid: "off"` (saves ~20ms, but loses exact-symbol coverage)

**Target:** <4.5s query latency (leaves 500ms buffer)

### Option 3: Make Timeout Configurable

**Add to config:**
```jsonc
{
  "retrieval": {
    "hookTimeoutMs": 5000  // Adjustable per-project
  }
}
```

**Pros:** Users can tune based on corpus size
**Cons:** Doesn't fix the underlying performance issue

### Option 4: Async Injection (Future)

**Idea:** Hook returns immediately, daemon pushes injection via separate channel (WebSocket, polling, file-based).

**Pros:** No timeout concerns, scales to any corpus size
**Cons:** Major architecture change, breaks Claude Code's synchronous hook model

## Current State

**Deployed:** 10s timeout (both hook script and hooks.json) — bumped from 5s in v0.5.0
**Corpus latency:** 5.0-5.4s (within timeout now, but no margin for growth)
**Result:** Injection works, but performance optimization is still needed for corpus scale

**Next step:** Optimize query performance (Option 2) to get latency under 4s, restoring healthy buffer.

## Related Issues

- **Large corpus scale:** As corpus grows, latency increases linearly
- **Expansion adaptive threshold:** Queries scoring <0.55 trigger expansion, adding 100-400ms
- **No LRU cache:** Every query re-scans full corpus (LanceDB doesn't cache search results)

## Code Locations

- `hooks/hooks.json` line 22 — Hook timeout (5000ms)
- `scripts/query-hook.js` line 57 — Fetch timeout (5000ms)
- `daemon/server.ts` — Query pipeline (no caching, full scan)
- `lib/retrieval/hybrid.ts` — Adds ~20ms per query
- `lib/retrieval/expand.ts` — Adds 100-400ms when fired
