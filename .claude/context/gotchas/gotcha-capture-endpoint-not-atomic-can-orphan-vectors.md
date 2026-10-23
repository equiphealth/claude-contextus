---
name: capture-endpoint-not-atomic-can-orphan-vectors
description: POST /capture is documented as one atomic step (write+index+embed) but observed to embed=true a file that never existed on disk — no checkpoint logging to attribute which stage actually failed
metadata:
  type: gotcha
  tags: ["capture", "embed", "atomicity", "orphan"]
---

# Gotcha: /capture is not actually atomic — can produce an embedded vector with no backing file

**Symptom**: `daemon.log` showed `Capture embedded (file=gotchas/gotcha-context-status-should-use-daemon-not-script.md, embedded=true)` at a specific timestamp, but that file does not exist on disk (confirmed via full filesystem search + `git status`) and is absent from `CONTEXT.md`. `POST /reconcile`'s `removeCount: 1` likely corresponds to cleaning up this orphaned vector row on the next pass, but there's no log line explaining which stage failed — embed succeeded independent of whether the write landed, and there's no way to tell from `daemon.log` alone whether the write never happened or happened and was later removed.

**Why it matters**: `/capture`'s own documentation (the per-turn hook instructions) describes it as "ONE Bash call handles file creation, index update, and embedding" — implying atomicity/all-or-nothing. This observation shows that's not guaranteed: it's possible to end up with a vector entry and no file, silently, self-healing only via `removeCount` on a later full reconcile (which itself gives no file-level detail — see https://github.com/equiphealth/claude-contextus/issues/72).

**How to apply**: if `/context-search` or retrieval surfaces a filename that doesn't exist when you go to open it, don't assume user error — check whether it's an orphaned vector row from a partial capture. Don't trust `embedded: true` in a `/capture` response as proof the file itself was written; verify with a follow-up read if it matters.

**Fix tracked**: https://github.com/equiphealth/claude-contextus/issues/71 — add explicit write/index/embed checkpoint logging to `/capture` so partial failures are attributable to a specific stage instead of only inferable from a later `removeCount`.
