---
name: stop-hook-transcript-timing
description: Stop hook fires before transcript write completes — response not yet on disk when hook reads file
metadata:
  type: gotcha
  tags: [hooks, stop, transcript, timing]
---

# Problem

The Stop hook fires immediately after the assistant finishes responding, but the transcript write is **async**. When `stop-evaluation.js` calls `lastTurnFromTranscript()`, it reads an incomplete file — the last user message is there, but the assistant response hasn't been flushed yet.

**Symptom**: Usage evaluation queue never gets created (`.eval-queue.jsonl` doesn't exist) even when context was injected and the hook fires.

## Why It Happens

Hook lifecycle order:
1. Assistant finishes streaming response to user
2. **Stop hook fires** (reads transcript path from stdin)
3. Hook reads transcript file from disk
4. Transcript write completes (async, 100-500ms later)

The hook reads too early — it sees the user prompt but not the assistant response, so `lastTurnFromTranscript()` returns empty `response: ''`, triggering the early-return at line 218.

## Evidence

```bash
# Session state shows injection happened
cat ~/.contextus/.session-state.json | jq '.["8fa4d8ac62c3"]'
# Output: patterns: [...], timestamp: "2026-06-26T15:12:46.484Z"

# But queue file never created
ls ~/.contextus/.eval-queue.jsonl
# ls: .eval-queue.jsonl: No such file or directory

# Transcript shows last entry is user turn (no assistant yet)
tail -1 transcript.jsonl | jq .type
# Output: "user"
```

## Fix Options

### 1. Retry with Backoff (Recommended)

Add a retry loop to `lastTurnFromTranscript()`:

```javascript
function lastTurnFromTranscript(transcriptPath, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { thinking, response } = readLatestTurn(transcriptPath);
    if (response) return { thinking, response }; // found it
    
    // Wait exponentially: 50ms, 100ms, 200ms, 400ms, 800ms
    if (attempt < maxRetries - 1) {
      const delayMs = 50 * Math.pow(2, attempt);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
  return { thinking: '', response: '' }; // give up after 1.6s total
}
```

**Pros**: Handles the race condition, bounded wait time  
**Cons**: Adds up to ~1.6s latency to Stop hook (acceptable — hook is async, doesn't block user)

### 2. Use Hook Stdin Content (Ideal, if Available)

If Claude Code can pass the assistant message content directly on stdin (not just transcript path), we avoid the file read entirely:

```javascript
const payload = JSON.parse(await readStdin());
const response = payload.assistant_message?.content
  ?.filter(b => b.type === 'text')
  .map(b => b.text)
  .join('\n') || '';
```

**Pros**: No file race, instant  
**Cons**: Requires Claude Code to send message content on Stop hook stdin (may not be supported)

### 3. Defer to Next UserPromptSubmit

Store "pending eval" in session-state at Stop, then the **next** UserPromptSubmit hook reads the transcript (which is complete by then) and enqueues.

**Pros**: Guaranteed complete transcript  
**Cons**: Eval only happens if user sends another prompt (fails on last turn of session)

## Recommendation

**Use retry with backoff (Option 1)** — simple, handles the race, bounded overhead. The Stop hook is already async (doesn't block user), so 100-500ms wait is acceptable.

## Testing After Fix

```bash
# Trigger context injection
echo "How does query expansion work?"

# Wait for Stop hook to fire (~2s for retry loop)
sleep 3

# Verify queue was created
ls -lh ~/.contextus/.eval-queue.jsonl

# Check it has content
cat ~/.contextus/.eval-queue.jsonl | jq .
```

If the queue file exists with a valid job object, the retry worked.
