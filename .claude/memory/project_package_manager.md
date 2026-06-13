---
name: package-manager
description: Project uses pnpm, not npm
metadata:
  type: project
---

**Package manager**: pnpm (v10.34.3+)

Always use `pnpm install`, `pnpm add`, `pnpm remove` — never npm or yarn.

**Why**: Evidence from node_modules structure shows `.pnpm` cache directory. Using npm simultaneously with pnpm causes lock conflicts and slow installs (observed: 3 concurrent npm processes fighting over node_modules).

**How to apply**: When suggesting package operations, use pnpm commands.
