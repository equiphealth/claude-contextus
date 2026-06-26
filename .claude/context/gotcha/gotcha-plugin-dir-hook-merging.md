---
name: plugin-dir-hook-merging
description: --plugin-dir installs require manual hook merging from hooks/hooks.json to settings.json
metadata:
  type: gotcha
  tags: [hooks, installation, plugin-dir]
---

# Problem

When installing contextus via `--plugin-dir`, plugin hooks from `hooks/hooks.json` are **not** automatically merged into `~/.claude/settings.json`. The plugin runs and can be invoked via skills, but its hooks (UserPromptSubmit, SessionStart, Stop) won't fire.

**Symptom**: Usage evaluation doesn't collect data, context isn't injected on prompts, or daemon doesn't auto-start — despite the plugin being enabled and skills working.

## Why It Happens

Marketplace installs (via `claude install plugin`) merge hooks automatically. `--plugin-dir` installs run the plugin but skip the registration merge — you point Claude at a directory, not a published package, so the installer doesn't know which hooks to merge.

## Fix

**Manually copy hooks from `hooks/hooks.json` into `~/.claude/settings.json`**, merging them into the existing `hooks` object:

```bash
# Read contextus hooks
cat ~/.claude/plugins/contextus/hooks/hooks.json

# Merge into settings.json
# Add the hook objects to the appropriate event arrays
```

**Key hooks to merge**:
- **UserPromptSubmit**: Fires `/query` for context injection (required for retrieval)
- **Stop**: Enqueues usage evaluation jobs (required for Phase 1 eval)
- **SessionStart**: Auto-starts daemon, checks for upgrades (required for daemon lifecycle)

## Example

Contextus `hooks/hooks.json` defines:
```json
{
  "hooks": {
    "Stop": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-evaluation.js\"",
        "timeout": 5000
      }]
    }]
  }
}
```

Your `~/.claude/settings.json` might already have:
```json
{
  "hooks": {
    "Stop": [{
      "matcher": ".*",
      "hooks": [{
        "type": "command",
        "command": "lean-ctx hook observe"
      }]
    }]
  }
}
```

**Merge by adding to the hooks array** (don't replace):
```json
{
  "hooks": {
    "Stop": [{
      "matcher": ".*",
      "hooks": [
        {
          "type": "command",
          "command": "lean-ctx hook observe"
        },
        {
          "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-evaluation.js\"",
          "timeout": 5000
        }
      ]
    }]
  }
}
```

## Verification

After merging, test that hooks fire:

```bash
# Contextus Stop hook creates queue file after this turn ends
ls ~/.contextus/.eval-queue.jsonl

# Contextus UserPromptSubmit hook injects context (check response for [contextus — ...] blocks)
```

## When This Matters

Most users install via the marketplace and never hit this. `--plugin-dir` is the right pattern for:
- **Local development** (testing changes before publishing)
- **Heavy native deps** (e.g., contextus with LanceDB + daemon)
- **Git-cloned installs** (when not published to marketplace yet)

For these users, hook merging is a one-time manual step after initial `--plugin-dir` setup.

## Related

- See `MIGRATION_GUIDE.md § 3.3` — custom hooks coexist with plugin hooks
- See `dev/PACKAGING.md` — `--plugin-dir` is the supported personal install pattern for v1
