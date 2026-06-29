---
title: Skill Script Execution Pattern
description: Pattern for skills to run contextus scripts in both plugin and dev mode installations
author: Claude Sonnet
date: 2026-06-27
tags: [skills, development, patterns, plugin, dev-mode]
---

# Skill Script Execution Pattern

**For skills that need to run contextus scripts** — supports both installed plugin and dev mode.

## The Problem

Skills need to execute TypeScript scripts from the contextus codebase, but the installation location varies:
- **Installed plugin**: `~/.claude/plugins/contextus/`
- **Dev mode** (--plugin-dir): `~/src/claude-contextus/` (or any custom path)

Hardcoding paths breaks in one mode or the other.

## The Solution

Use the `find-contextus-root.sh` helper script:

```bash
# Detect contextus installation (queries daemon, then searches standard locations)
CONTEXTUS_ROOT=$(bash <(curl -s https://raw.githubusercontent.com/equiphealth/claude-contextus/main/scripts/find-contextus-root.sh)) || exit 1

TSX=$CONTEXTUS_ROOT/node_modules/.bin/tsx
SCRIPT=$CONTEXTUS_ROOT/scripts/cli/your-script.ts

# Run the script
$TSX "$SCRIPT" "$@"
```

**How it works:**
1. Queries the daemon at `http://127.0.0.1:${CONTEXTUS_DAEMON_PORT}/health` for `installRoot` (authoritative)
2. Falls back to searching standard locations if daemon isn't running
3. Validates the found directory actually contains contextus via `package.json`

**Configuration:** The daemon port is centralized in `scripts/daemon-config.sh` and defaults to `37800`. Override with `CONTEXTUS_DAEMON_PORT` environment variable.

## Pattern Variations

### Local installation (recommended for development)

When working on contextus itself, use a local path check:

```bash
# Assume we're in the contextus repo
CONTEXTUS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/your-script.ts "$@"
```

### Remote helper (recommended for skills)

For skills that might run anywhere:

```bash
# Download and run the helper (caches in /tmp)
HELPER="/tmp/find-contextus-root-$$.sh"
curl -sS https://raw.githubusercontent.com/equiphealth/claude-contextus/main/scripts/find-contextus-root.sh > "$HELPER"
CONTEXTUS_ROOT=$(bash "$HELPER") || exit 1
rm -f "$HELPER"

$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/your-script.ts "$@"
```

### Inline (quick and dirty)

For one-off commands:

```bash
CONTEXTUS_ROOT=$(curl -s "${CONTEXTUS_DAEMON_URL:-http://127.0.0.1:37800}/health" 2>/dev/null | grep -o '"installRoot":"[^"]*"' | cut -d'"' -f4 || echo "$HOME/.claude/plugins/contextus")
$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/your-script.ts "$@"
```

## When to Use Each Pattern

| Pattern | Use When |
|---------|----------|
| **Single command** | Skill runs one script, execution is simple |
| **Multiple scripts** | Skill runs several scripts or references paths multiple times |
| **With error handling** | Script failure would be confusing without context, or for user-facing skills |

## Skill Documentation Template

When documenting the command in a skill's "Implementation" section:

```markdown
### Implementation

```bash
# Detect contextus installation (plugin or dev mode)
CONTEXTUS_ROOT=$([ -d ~/.claude/plugins/contextus ] && echo ~/.claude/plugins/contextus || echo ~/src/claude-contextus)
$CONTEXTUS_ROOT/node_modules/.bin/tsx $CONTEXTUS_ROOT/scripts/cli/your-script.ts [options]
```

**Dev mode note**: The script auto-detects whether contextus is installed as a plugin
(`~/.claude/plugins/contextus`) or running with `--plugin-dir` for development
(`~/src/claude-contextus`).
```

## Related

- `docs/development.md` — Dev mode setup and --plugin-dir usage
- `scripts/cli/` — All CLI scripts that skills might invoke
