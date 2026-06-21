# Link Project

Share context bidirectionally with another project via workspaces.

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
- `--workspace <name>` — explicit workspace name (default: auto-derived from project basenames)

### 3. Confirm

Show the user:
- How many context files are now available from the linked project
- That the daemon will re-embed in the background
- That both projects now share context bidirectionally (same workspace)

### 4. Explain ranking

Workspace sibling context is ranked at 0.85 — below your project's own patterns (1.0) and docs (0.9), but above personal user context (0.8). This means your project's patterns always win when both match, but sibling context surfaces when your project doesn't have relevant coverage.

## Commands Reference

| Command | Purpose |
|---------|---------|
| `pnpm link-project <path>` | Link a project (creates/joins workspace) |
| `pnpm link-project <path> --workspace foo` | Link to a named workspace |
| `pnpm link-project --list` | Show workspaces for this project |
| `pnpm link-project --remove <path>` | Remove a project from workspace |

## Notes

- Workspace definitions stored in `~/.contextus/workspaces/<name>.jsonc` (machine-local, paths are absolute)
- Linking is bidirectional — both projects join the same workspace and see each other's context
- On unlink, orphan rows are cleaned on next reconcile (session start or manual)
- Linux: no live watcher — changes picked up on next session start
