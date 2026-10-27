---
name: contextus-setup
description: Run this first after install. Guided setup wizard — scaffold, configure, and embed for a project. Two tracks (quick/power user). First-run or re-configure.
---

# contextus-setup

Interactive onboarding that gets contextus from "installed" to "actively injecting your patterns".

## When to use

- **First time** in a project after installing the plugin
- After moving/renaming the project (re-register)
- **Re-configure** — run anytime to change settings
- **Tune** — `--tune` after ~1 week of usage to calibrate thresholds

## How to run

```bash
/contextus-setup                  # guided wizard
/contextus-setup --tune           # calibrate from usage data
/contextus-setup --quick          # skip questions, use defaults
```

## Instructions

When invoked, follow the implementation flow in the reference guide:

1. Run `setup-detect.ts` to gather project state
2. Route based on state (first-run / re-run / partial setup)
3. Guide user through Quick or Power User track
4. Handle Ollama installation if needed (via helper scripts)
5. Configure embedding provider and thresholds
6. Write config, register stanza, run initial embed

See [./reference.md](./reference.md) for:
- Complete decision tree (Quick vs Power User tracks)
- State detection JSON schema
- Ollama installation flow by platform
- Helper scripts (`install-ollama.ts`, `pull-ollama-model.ts`)
- Config writing and stanza registration
- Calibration mode implementation
- All prompts, error handling, and edge cases
