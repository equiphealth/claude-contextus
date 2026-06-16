---
name: daemon-lifecycle
description: OPEN — should the daemon run constantly, or shut down when idle / no sessions open? Leaning idle-timeout backstop + session-awareness
metadata:
  type: question
  tags:
    - daemon
    - lifecycle
    - ux
    - open-question
---

**OPEN QUESTION** (raised 2026-06-15): should the daemon run constantly? Today it's
persistent (detached, no SessionEnd hook, no idle exit — only SIGTERM/reboot stops it).

**Cost (measured):** ~136MB RSS idle, ~0 idle CPU. On `ollama` the model is NOT
in-process (POSTs to Ollama); on `transformers` the ONNX model loads in-process
(heavier — but that's the "warm model without Ollama" the author wants).

**Leaning toward** (not yet decided):
1. Cheap wins first: a `/contextus-stop` command + an **idle auto-shutdown timer** in
   `daemon/server.ts` (~15 lines; respawn machinery already exists, so shutdown is safe).
2. Then layer **session-awareness** on top (shut down when the last session cleanly
   closes) — but NEVER as a replacement for the idle timer, because **`SessionEnd` is
   best-effort**: it may not fire on SIGKILL / terminal-close / IDE crash, leaving a
   stale session id → daemon never stops. The idle timer is the robust backstop.
3. Also: only spawn in projects where contextus is set up (reuse the populated-context /
   CLAUDE.md-stanza signal session-start already computes).

**Resolve to** a `decision-daemon-lifecycle` file when chosen. Full analysis:
`docs/dev/DAEMON_LIFECYCLE.md`.
