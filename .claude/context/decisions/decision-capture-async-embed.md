---
name: capture-async-embed
description: POST /capture should write file synchronously but embed asynchronously for instant response
metadata:
  type: decision
---

Problem: The /capture endpoint blocks on embedSingleFile() which includes embedding the document (~100-500ms depending on provider). This delays the LLM response to the user.

Solution: Split the endpoint into sync (fast) and async (background) phases:

1. SYNC (return immediately, <10ms):
   - Validate params
   - Write file to disk
   - Append CONTEXT.md index
   - Log to captures.log
   - Return {ok: true, file, embedded: "pending"}

2. ASYNC (fire-and-forget after response):
   - embedSingleFile()
   - invalidateCorpusCache()
   - Log embed success/failure

Why this is safe: The file exists on disk immediately (git can see it, reconcile will find it). If async embed fails, next reconcile or daemon restart picks it up. The user never notices the 200ms embed latency.

This also dissolves the start-vs-end debate. With <10ms response time, capturing at the start costs nothing perceptible. The FIRST instruction stays correct without a UX penalty.

Implementation: Replace `await embedSingleFile(...)` with `embedSingleFile(...).then(...).catch(...)` (no await). The response returns before embedding completes.
