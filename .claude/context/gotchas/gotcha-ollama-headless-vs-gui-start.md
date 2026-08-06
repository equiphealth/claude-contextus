---
name: ollama-headless-vs-gui-start
description: ollama serve is headless and survives session close; open -a Ollama launches the GUI app — don't confuse them when scripting/testing
metadata:
  type: gotcha
  tags: ["ollama", "macos", "setup-wizard"]
---

# Ollama: headless CLI start vs GUI app launch

## The mistake

When simulating or scripting Ollama start/stop (e.g. testing the `/contextus-setup` wizard's `installed-stopped` branch), it's tempting to "restore" the service with:

```bash
open -a Ollama
```

**Don't.** This launches the actual macOS `.app` bundle (`/Applications/Ollama.app`), which pops up its menu bar icon / GUI — intrusive and visible to the user, even though all we wanted was the background server back.

## The correct headless method

```bash
ollama serve > /tmp/ollama-serve.log 2>&1 &
disown
```

This is exactly what `skills/contextus-setup/reference.md` already documents for the `installed-stopped` branch ("run `ollama serve` in background") — it's the bare CLI binary, no GUI code path, no dock icon. No special flag needed; it's headless by default.

## Two separate installations, easy to conflate

On a machine with both installed (common if the user installed via `ollama.com`'s .dmg AND later via `brew install ollama`, or vice versa):

- `/opt/homebrew/bin/ollama` — brew formula, CLI-only binary, `ollama serve` works headlessly
- `/Applications/Ollama.app` — GUI app bundle, supervises its own child `ollama serve` process and **auto-restarts it if you kill only the child** (you must kill both the app process and its child, or use `pkill -f "Ollama.app"`, to actually stop it)

`brew services list` will show `ollama none` even when the `.app`-launched instance is running and reachable on port 11434 — brew services only tracks the brew-managed launchd service, not the app-launched one. Don't use brew services status as a proxy for "is Ollama running" — check the port/API directly (`ollamaReachable` in `setup-detect.ts` does this correctly).

## When restoring/switching between the two

To stop the app-supervised instance cleanly:
```bash
pkill -f "Ollama.app"   # kills both the app process and its child serve process
```

To start headless afterward:
```bash
ollama serve > /tmp/ollama-serve.log 2>&1 &
disown
```

`brew services start ollama` is a third option — starts it as a proper launchd-managed background service that persists across reboots. Solves persistence, not "avoid the GUI" (bare `ollama serve` already avoids the GUI on its own).

## Does it survive when the wizard's session closes?

Yes, when started via Claude Code's Bash tool (as the `/contextus-setup` wizard does). Verified directly:

```bash
ps -p <ollama-serve-pid> -o pid,ppid,pgid,sess,tty,comm
#  PID  PPID  PGID   SESS TTY      COMM
# 63415     1 63312      0 ??       ollama
```

Two things make this safe:
1. **`PPID` is `1`** — already reparented to launchd/init. The invoking shell is long gone; nothing that could take it down when the session ends is still around.
2. **`TTY` is `??`** — no controlling terminal at all. Claude Code's Bash tool doesn't allocate a real pty per command, so there's no terminal-close event to deliver `SIGHUP` in the first place.

So `ollama serve &` (with or without `disown`) launched through the wizard's Bash calls is already detached the moment the tool call returns — closing the Claude Code session afterward doesn't touch it.

**Caveat for a real interactive terminal** (a human running this by hand in Terminal.app/iTerm, not through the wizard): plain `&` + `disown` is usually fine on a normal `exit`, but closing the whole terminal *window* destroys the pty, and the kernel can still `SIGHUP` a disowned job that shares that controlling terminal. `nohup ollama serve &` is the robust version there — makes the process ignore `SIGHUP` regardless of ctty teardown. Not needed for the wizard's own Bash-tool invocations (no ctty to lose), but worth using if writing a setup script meant to also be run by hand.

## Related

- Discovered while manually walking through the `/contextus-setup` wizard's `installed-stopped` → `installed-running` transition (2026-07-21) to validate PR #26's shipped Ollama detection logic
- `scripts/setup-detect.ts` correctly detects reachability via HTTP, not process/service inspection — that's the right approach, this gotcha is about the *manual* commands used to test it
