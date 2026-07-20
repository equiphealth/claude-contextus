---
name: capture-silent-fail-during-heavy-ops
description: Daemon /capture returns continue:true instead of error/queuing when busy with embedding — captures silently dropped
metadata:
  type: gotcha
  tags: ["daemon", "capture", "bug"]
---

# Gotcha: Captures Silently Fail When Daemon is Busy

## Symptom

Calling `/capture` endpoint returns `{"continue": true}` (hook response format) instead of capture confirmation. The context file is NOT created, and there's no error.

## When It Happens

- Daemon is busy with heavy operations (embedding, large corpus queries)
- Specifically observed during automation corpus re-embedding after daemon restart
- Response is immediate (not timeout) — suggests request was handled but wrong codepath

## Root Cause

**Hypothesis**: `/capture` endpoint shares response handling with hook endpoints, and returns generic hook response when unable to process capture immediately.

## Impact

- **Silent data loss** — Capture request appears to succeed but file isn't created
- **No retry indication** — Caller doesn't know to retry
- **Hard to debug** — No error logged, looks like success

## Workaround

1. **Check capture result**: If response is `{"continue": true}` instead of `{"ok": true, "file": "..."}`, retry
2. **Wait for daemon idle**: Check `/health` endpoint, wait if `modelLoaded: false` or high activity
3. **Verify file created**: After capture, check if file exists at expected path

```bash
# Robust capture with verification
RESPONSE=$(curl -s -X POST http://127.0.0.1:37800/capture -H 'Content-Type: application/json' -d @payload.json)
if echo "$RESPONSE" | grep -q '"ok": *true'; then
  echo "Capture succeeded"
else
  echo "Capture may have failed: $RESPONSE"
  # Retry or handle error
fi
```

## Example

**Context**: Just restarted daemon, automation corpus re-embedding in progress

**Request**:
```bash
curl -X POST http://127.0.0.1:37800/capture -d @decision.json
```

**Expected response**:
```json
{"ok": true, "file": ".claude/context/decisions/...", "relPath": "..."}
```

**Actual response**:
```json
{"continue": true}
```

**Result**: File NOT created, CLAUDE.md still needed manual edit

## Fix Needed

1. **Return proper error** when capture can't be processed:
   ```json
   {"ok": false, "error": "daemon busy, retry later"}
   ```

2. **Queue captures** instead of dropping them

3. **Separate response types** — hook responses vs capture responses shouldn't collide

4. **Log dropped captures** so they're debuggable

## Related

- Observed in session 2026-07-20 after daemon restart
- Daemon uptime was ~6 seconds when capture attempted
- Health endpoint showed `status: ok` but capture still failed
