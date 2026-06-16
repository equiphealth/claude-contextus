# Daemon Lifecycle — should it run constantly?

**Status:** Open design question (raised by user, 2026-06-15). No behavior change yet.

## The question

Today the daemon is **persistent**: spawned detached + `unref()`'d by the SessionStart
/ query hooks, with **no SessionEnd hook, no idle timeout, no self-exit** — it lives
until SIGTERM/SIGINT or reboot. A user may not want a background process running
constantly, especially in projects where they don't use contextus.

## What it actually costs (measured 2026-06-15)

- **~136MB RSS idle** on the `ollama` provider. Crucially, on ollama the daemon does
  **NOT** hold the embedding model in-process — it POSTs to the local Ollama server. So
  the heavy model memory lives in Ollama (which the user already opted into); our
  process is "Node + lancedb + HTTP server," not "a model resident in RAM."
- **On the `transformers` provider** it's heavier — the ONNX model loads in-process
  (`@xenova/transformers`, `pipeline()`), which is the whole "warm model" cost.
- **Idle CPU: ~0.** No polling loop between prompts; the eval worker only does work
  during a calibration campaign.

So the honest framing is "a backgrounded ~100MB Node server," not "a model hogging RAM
24/7." Worth stating plainly in user docs rather than letting people imagine worse.

> **User wish (2026-06-15):** be able to run the `transformers` provider WITH a
> persistently loaded model — i.e. get ollama-like warmth without requiring Ollama. The
> daemon already does this (the in-process pipeline stays warm across queries); the open
> part is making it a first-class, documented mode and weighing its RAM cost against the
> lifecycle options below.

## Precedent

claude-mem runs a persistent server too. So "this class of plugin runs a daemon" is not
outside user expectations — but that doesn't excuse the two real UX gaps below.

## The two genuine UX gaps (independent of "should it run")

1. **No off switch.** There is no `/contextus-stop` and no SessionEnd cleanup. To make
   it stop, a user must find the PID (`~/.contextus/runtime/daemon.pid`) and kill it.
   That's the real friction — not that it runs, but that stopping it requires spelunking.
2. **Runs in projects that don't use contextus.** Installed globally, the daemon spawns
   on every session regardless. The author's `claude()` zsh wrapper sidesteps this
   personally; a marketplace user has no such wrapper.

## Options

| Approach | Idle cost | Tradeoff |
|---|---|---|
| **Persistent (today)** | ~136MB, always up | Warm model → ~150ms queries. The design goal. |
| **Idle auto-shutdown** | Spins down after N min idle | Next prompt cold-starts (model reload, seconds). Hooks already respawn. |
| **Session ref-counting** (user's lean) | Down when 0 sessions open | Matches intuition ("nothing open → nothing running"), but see reliability catch. |
| **On-demand / no daemon** | Zero | Every query cold-loads → defeats the warm-model purpose. |

## User's lean: detect whether other sessions are open

Track open sessions and shut the daemon down when the last one closes. Findings from
the Claude Code hook docs (verified 2026-06-15, code.claude.com/docs/en/hooks.md):

- **`SessionEnd` hook EXISTS** and carries a stable **`session_id`** (same id as the
  matching SessionStart). So ref-counting is mechanically possible: record `session_id`
  on SessionStart, remove on SessionEnd; when the set empties, stop the daemon.
- **`SessionStart` has a `source` field** (`startup | resume | clear | compact`) — useful
  to avoid miscounting a `/clear` or `compact` as a new session.
- **⚠️ THE CATCH — SessionEnd is best-effort, not guaranteed.** It fires on documented
  cases (`/clear`, logout, prompt-exit, pause, "other") but the docs do NOT guarantee it
  on abrupt termination (SIGKILL, terminal force-closed, IDE crash). A missed SessionEnd
  leaves a **stale session id in the set → the daemon never shuts down** (the exact
  failure we're trying to avoid). So naive ref-counting silently degrades to
  "persistent" — arguably worse than an honest persistent daemon, because it *looks*
  like it should clean up.

### So ref-counting needs a liveness backstop

Don't trust the count alone. Combine:
1. **Ref-count** via SessionStart/SessionEnd `session_id` (the happy path).
2. **Liveness sweep** to evict stale ids — e.g. on each hook tick or a cheap timer,
   prune session ids whose Claude Code transcript under `~/.claude/projects/` is no
   longer being written / whose process is gone. Shut down only when (count == 0) AND
   (no recent transcript activity).
3. Effectively this collapses toward **"idle timeout, but session-aware"** — which is
   probably the right synthesis: an idle timer is the robust backstop, and the session
   count just lets it shut down *promptly* when everything's cleanly closed instead of
   waiting out the full idle window.

## Recommendation

- **Near term:** ship the cheap, unambiguous wins — a **`/contextus-stop`** command and
  an **idle auto-shutdown** timer in `daemon/server.ts` (the respawn machinery already
  exists, so shutdown is safe; worst case is one cold query on return). ~15 lines.
- **Then:** layer **session-awareness** on top of the idle timer (prompt shutdown when
  the last session cleanly ends) — NOT as a replacement for the idle backstop, because
  SessionEnd can't be trusted to always fire.
- **Also worth:** only spawn in projects where contextus is actually set up (the
  populated-`.claude/context/` or CLAUDE.md-stanza signal the session-start nudge already
  computes) — addresses gap #2 for marketplace users without a shell wrapper.

## Related

- `docs/dev/DESIGN.md` — the warm-model rationale the daemon exists to serve.
- `scripts/lib/daemon-control.js` — spawn/respawn machinery (detached, health-checked).
- `daemon/server.ts` — SIGTERM/SIGINT handlers; where an idle timer would live.
