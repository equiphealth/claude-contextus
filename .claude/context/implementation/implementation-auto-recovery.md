---
name: auto-recovery
description: How the daemon recovers from provider failures with exponential backoff and keyword fallback
metadata:
  type: implementation
  tags: [daemon, recovery, warmup, ollama, degradation]
---

# Auto-Recovery Implementation

When the embedding provider drops mid-session (Ollama crashes, network hiccup), the daemon **automatically recovers** via warmup retry with exponential backoff + keyword fallback for immediate degradation.

## State Tracking

Three daemon-level globals:

```typescript
let modelLoaded = false;       // true when embedding provider is warm
let warmupError: string | null = null; // error message if warmup failed
let warmupRetryTimer: ReturnType<typeof setTimeout> | null = null; // scheduled retry
```

**Transitions:**

- **Healthy:** `modelLoaded=true`, `warmupError=null`
- **Loading:** `modelLoaded=false`, `warmupError=null`, retry scheduled
- **Failed:** `modelLoaded=false`, `warmupError="..."`, retries exhausted

## Startup Warmup

On daemon start:

```typescript
server.listen(PORT, '127.0.0.1', () => {
  writeRuntimeFiles();
  logInfo('Daemon started', { pid: process.pid, port: PORT });
  
  // Warm AFTER socket is listening so /health is reachable
  attemptWarmup();
});
```

**Why after listen?** SessionStart hook polls `/health` waiting for `modelLoaded:true`. If warmup blocks before the socket binds, health checks fail and the session thinks the daemon is down.

## Warmup Retry Logic

```typescript
function attemptWarmup(attempt = 0): void {
  warmup()
    .then(() => {
      modelLoaded = true;
      warmupError = null;
      logInfo('Model warm', { attempt: attempt + 1 });
    })
    .catch((err) => {
      warmupError = err.message;
      logError('Model warmup failed', { attempt: attempt + 1 });
      
      if (attempt < WARMUP_MAX_RETRIES) {
        const delay = WARMUP_BASE_DELAY_MS * Math.pow(2, attempt);
        warmupRetryTimer = setTimeout(() => attemptWarmup(attempt + 1), delay);
        logInfo('Warmup retry scheduled', { nextAttempt: attempt + 2, delayMs: delay });
      } else {
        logError('Warmup retries exhausted — restart daemon or provider');
      }
    });
}
```

**Exponential backoff:**
- Attempt 1: 10s delay
- Attempt 2: 20s
- Attempt 3: 40s
- Attempt 4: 80s
- Attempt 5: 160s (2min 40s)
- Max retries: 5

**Constants:**
```typescript
const WARMUP_MAX_RETRIES = 5;
const WARMUP_BASE_DELAY_MS = 10_000;
```

## Mid-Session Recovery

**When embedding fails during /query:**

```typescript
try {
  const vec = await embedQuery(prompt);
  raw = await search(vec, fetchLimit, undefined, project);
} catch (embedErr) {
  // Provider dropped mid-session — mark down and trigger re-warmup
  modelLoaded = false;
  warmupError = embedErr.message;
  logError('Embedding failed, attempting keyword fallback + triggering re-warmup');
  
  if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
  attemptWarmup();
  
  // Try keyword fallback before giving up entirely
  const corpus = await loadCorpusForKeyword(project);
  const keywordResults = keywordSearch(corpus, prompt, cfg.retrieval.topK);
  
  if (keywordResults.length === 0) {
    return sendJson(res, 200, { continue: true });
  }
  
  raw = keywordResults;
  usedKeywordFallback = true;
}
```

**Flow:**

1. **Embedding fails** (Ollama unreachable)
2. **Mark model down** (`modelLoaded = false`)
3. **Trigger warmup retry** (background recovery)
4. **Try keyword fallback** (immediate degradation)
5. **Return results or no-inject** (never block the prompt)

## Health Probe

`GET /health?probe=true` actively verifies the provider:

```typescript
if (url.searchParams.get('probe') === 'true' && modelLoaded) {
  try {
    await embedQuery('health');
  } catch (err) {
    modelLoaded = false;
    warmupError = err.message;
    logError('Health probe failed — provider down, triggering re-warmup');
    
    if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
    attemptWarmup();
  }
}
```

**Without probe:** Health just reports cached `modelLoaded` (fast, but stale).

**With probe:** Health embeds a test query to verify provider is actually reachable.

## Graceful Degradation

When `modelLoaded = false`, `/query` returns early:

```typescript
if (!modelLoaded) {
  logInfo('Query before model warm — skipping');
  return sendJson(res, 200, { continue: true });
}
```

**Result:** Claude proceeds without context injection. The prompt isn't blocked.

## Recovery Signal

When warmup succeeds after retries:

```typescript
logInfo('Model warm (recovered)', {
  model: cfg.embedding.model,
  afterAttempt: attempt + 1
});
```

Future queries succeed normally.

## Cleanup

On daemon shutdown (`SIGINT`, `SIGTERM`):

```typescript
if (warmupRetryTimer) clearTimeout(warmupRetryTimer);
cleanupRuntimeFiles();
server.close(() => process.exit(0));
```

Pending retries are canceled.

## Observability

**Logs (daemon.log):**

```json
{"event": "Model warmup failed", "attempt": 1, "message": "connect ECONNREFUSED ::1:11434"}
{"event": "Warmup retry scheduled", "nextAttempt": 2, "delayMs": 20000}
{"event": "Model warm (recovered)", "afterAttempt": 3}
```

**Health endpoint:**

```json
{
  "status": "ok",
  "modelLoaded": false,
  "warmupError": "connect ECONNREFUSED ::1:11434"
}
```

SessionStart hook reads `warmupError` and warns the user if provider is down.

## Tradeoffs

**Pros:**
- Automatic recovery (no manual daemon restart)
- Exponential backoff prevents hammering a down provider
- Keyword fallback provides immediate degradation (some context > no context)
- Never blocks a prompt (always returns `{"continue": true}`)

**Cons:**
- 5 retries × 2.6min = up to ~5min recovery time
- Keyword fallback is lower quality than semantic search
- Provider outages lasting hours require manual intervention

## Code Location

- `daemon/server.ts` — Warmup retry logic (lines 653-691)
- `daemon/server.ts` — Mid-session recovery (lines 252-285)
- `daemon/server.ts` — Health probe (lines 122-139)

## Related

- **Keyword fallback** — Immediate degradation when provider fails
- **Health endpoint** — Exposes `modelLoaded` and `warmupError`
- **SessionStart hook** — Polls health and warns if provider down
