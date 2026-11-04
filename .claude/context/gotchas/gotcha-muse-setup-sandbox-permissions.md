---
name: muse-setup-sandbox-permissions
description: >-
  Muse sandbox blocks localhost, tsx IPC, and detached launch during setup —
  route around it, do not misread as down services
metadata:
  type: gotcha
  tags:
    - muse
    - setup
    - sandbox
    - daemon
---

# Muse Setup Sandbox Permissions

Running `/contextus-setup` (or `/manage-daemon restart`) from inside a Muse agent turn hits the managed shell sandbox, and every failure looks like a down service. Observed live 2026-10-30.

## Symptoms (all sandbox denials, NOT down services)

- `tsx <plugin>/scripts/setup-detect.ts` fails with `EPERM ... listen ... .pipe` — its IPC server cannot bind.
- `ollama list` fails with `dial tcp 127.0.0.1:11434: connect: operation not permitted`; plain `curl` to `localhost:11434` or daemon `:37800` returns empty in the same session.
- `nohup ... & disown` relaunch is rejected by the harness ("unmanaged shell backgrounding is not allowed"); macOS ships no `setsid`, so no replacement daemon can outlive the session.

## Root cause

The default sandbox denies listening sockets, localhost TCP, and backgrounding. Empty curl / EPERM therefore carry zero information about whether Ollama or the daemon is actually running.

## Workaround

- Never route to the installed-stopped / not-installed provider flows on sandbox-denied evidence.
- Request one user-approved escalated run covering Ollama tags + `ollama list` + daemon `/health` together (or ask the user to verify from their own terminal, or re-run with `--sandbox-network enabled`). Prefer the single-shot setup-engine call for that run.
- For a daemon restart, hand the user the exact stop + `nohup` + `/health` terminal commands to run outside the session, then verify `modelLoaded: true` and PPID 1 after. A session-managed daemon is a temporary bridge only, never a restart — and never stop a healthy daemon without a surviving replacement guaranteed.
- Encoded in `skills/contextus-setup/reference.md` (Step 0b sandbox-denial signatures) and `skills/manage-daemon/reference.md` (no in-session restart note).

