# Link Project

Share another project's context patterns with the current project.

## When to use

- User wants cross-project context ("link automation", "share context from X")
- User mentions patterns from another project they want available here
- Setup wizard detects other contextus-enabled projects nearby

## Flow

### 1. Gather info

If the user didn't provide a path, ask:
> Which project would you like to link? Provide the path, or I can check what contextus projects exist on this machine.

To discover available projects:
```bash
pnpm link-project --list
```

If no path given, check what's available:
```bash
pnpm setup-detect
```
(The `existingProjects` field lists other contextus-enabled projects.)

### 2. Link it

```bash
pnpm link-project <path>
```

Options:
- `--name <name>` — override the default name (basename of path)

### 3. Confirm

Show the user:
- How many context files are now available from the linked project
- That the daemon will re-embed in the background
- That changes in the linked project refresh automatically (macOS/Win)

### 4. Explain ranking

Linked context is ranked at 0.85 — below your project's own patterns (1.0) and docs (0.9), but above personal user context (0.8). This means your project's patterns always win when both match, but linked context surfaces when your project doesn't have relevant coverage.

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm link-project <path>` | Link a project |
| `pnpm link-project <path> --name foo` | Link with custom name |
| `pnpm link-project --list` | Show current links |
| `pnpm link-project --remove <name>` | Unlink a project |

## Notes

- Linked project config is stored in tier-2 (machine-local: `~/.contextus/data/<project>/config.json`) because paths are absolute and machine-specific
- On unlink, orphan rows are cleaned on next reconcile (session start or manual)
- Linux: no live watcher — changes picked up on next session start
