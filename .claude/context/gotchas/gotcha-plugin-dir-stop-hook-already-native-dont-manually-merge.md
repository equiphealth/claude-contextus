---
name: plugin-dir-stop-hook-already-native-dont-manually-merge
description: >-
  A --plugin-dir Stop hook fired natively via CLAUDE_PLUGIN_ROOT even though
  gotcha-plugin-dir-hook-merging.md claims plugin-dir never auto-merges hooks -
  manually adding it to settings.json caused a duplicate double-fire instead of
  fixing a gap
metadata:
  type: gotcha
  tags:
    - hooks
    - plugin-dir
    - stop-hook
    - installation
---

## Symptom

After adding a new `Stop` hook entry (`capture-gate-hook.js`) to `hooks/hooks.json` and manually merging a copy into `~/.claude/settings.json` (per the existing `gotcha-plugin-dir-hook-merging.md`, which claims `--plugin-dir` installs never auto-merge plugin hooks), the Stop hook fired TWICE in the same stop cycle with two separate error messages:

```
Stop hook error (from "node \"/Users/.../scripts/capture-gate-hook.js\""): ...
Stop hook error (from "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-gate-hook.js\""): ...
```

One message cites the literal absolute path (the manually-merged `settings.json` copy); the other cites `${CLAUDE_PLUGIN_ROOT}` unexpanded in the log text, which only appears when the command comes from the plugin's OWN `hooks/hooks.json` registration, not a manual settings.json copy (manual copies must hardcode an absolute path, since `${CLAUDE_PLUGIN_ROOT}` has no meaning outside the plugin's own hook-loading context).

## Root cause

This is live, direct evidence that the plugin's native `Stop` hook WAS already being loaded and fired on its own for this `--plugin-dir` session - contradicting the blanket claim in `gotcha-plugin-dir-hook-merging.md` ("plugin hooks... won't fire" for `--plugin-dir` installs). That gotcha may be stale (written against an older Claude Code version), or may only be accurate for some hook events and not others (it was written in the context of UserPromptSubmit/SessionStart/Stop generally, but this is only confirmed-wrong for `Stop` specifically here) - not fully re-verified for every event type.

Manually re-merging a hook that was already natively active didn't fix a gap - it created a duplicate, double-firing registration of the same script.

## How to apply

Before manually merging ANY hook into `~/.claude/settings.json` for a `--plugin-dir` install (per the older gotcha's documented fix), first verify the hook isn't already firing natively - e.g. make a one-off test commit and watch for the hook's effect (block message, log file, etc.) BEFORE assuming it's missing and copying it in by hand. If it already fires, do nothing; manually adding it will double-register it instead.

## Related

Supersedes/narrows the blanket claim in `gotchas/gotcha-plugin-dir-hook-merging.md` for at least the `Stop` event - that file has not yet been corrected/scoped down to reflect this; a future session should reconcile the two rather than trust the older claim at face value.
