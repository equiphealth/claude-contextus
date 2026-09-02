---
name: setup-time-plugin-presence-check-hook
description: Plugin-presence check hooks must live in the project's own settings.json, not shipped by contextus itself, because contextus's hooks never fire if the plugin isn't loaded
metadata:
  type: decision
  tags: ["setup", "hooks", "onboarding", "plugin-dir"]
---

# Decision

Offer an opt-in setup step (in `/contextus-setup`) that scaffolds a lightweight `SessionStart` hook directly into the *project's* `.claude/settings.json`, whose only job is to warn when the contextus plugin is not installed/enabled. This hook is NOT part of contextus's own `hooks/hooks.json` — it must be written separately, by the setup wizard, into the consuming project.

## Why

Contextus cannot self-report its own absence. Its `SessionStart` hook (`scripts/session-start-hook.js`, registered via `hooks/hooks.json`) only executes if the plugin is already loaded and its hooks were merged into `settings.json`. If a teammate clones a repo that expects contextus but never ran `/plugin install`, or used a `--plugin-dir` install where hook merging didn't happen (see [[gotcha-plugin-dir-hook-merging]]), there is no code path inside the plugin that can detect and warn about that state — by definition, if it's missing, nothing belonging to it runs.

The only way to catch this is a check that lives *outside* the plugin, hardcoded into the project's own committed `settings.json`, so it fires regardless of whether contextus is present.

This was surfaced from a live example: a hand-written `SessionStart` hook in a separate automation repo that ran `claude plugin list | grep contextus` and printed install instructions if missing. It worked in intent but used the OLD flat hook shape (`{"command": "bash", "args": [...]}`)  instead of the current Claude Code schema (array of `{matcher, hooks:[{type:"command", command}]}`), so it had silently bit-rotted.

## How to apply

- Do not try to add this check to `hooks/hooks.json` — it belongs to the *consumer* project, not contextus itself.
- When building this into `/contextus-setup` (`scripts/contextus-setup.ts`), generate the hook using the CURRENT array-based schema, e.g.:
  ```json
  {
    "hooks": {
      "SessionStart": [
        {
          "matcher": ".*",
          "hooks": [
            {
              "type": "command",
              "command": "bash -c \"if ! claude plugin list 2>/dev/null | grep -q 'contextus.*enabled'; then echo 'WARNING: contextus plugin not detected.'; fi\""
            }
          ]
        }
      ]
    }
  }
  ```
- Merge into any existing `SessionStart` array entries rather than overwriting (see [[gotcha-plugin-dir-hook-merging]] for the general merge pattern).
- Make it opt-in during setup ("add a plugin-presence check to this project's settings.json?") — most single-user installs don't need it; it's aimed at team repos where contextus is a shared convention and a teammate might clone without installing it.
- Keep the check itself cheap and non-blocking (single `bash -c` one-liner, short timeout) — it only needs to print a warning, not gate the session.

## Status

Not yet implemented. This documents the design direction agreed on 2026-08-17; implementation would touch `scripts/contextus-setup.ts` and possibly the setup skill's reference.md.

## Related

- [[gotcha-plugin-dir-hook-merging]] — the underlying reason hooks can go missing after install

