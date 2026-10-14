---
name: node-protocol-imports
description: "Always use node: protocol prefix for built-in module imports (fs → node:fs, path → node:path)"
metadata:
  type: decision
  tags: ["imports", "style", "sonarlint"]
---

# Use `node:` protocol for all built-in imports

All imports of Node.js built-in modules MUST use the `node:` prefix:

```typescript
// Correct
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// Wrong — bare specifier
import fs from 'fs';
import path from 'path';
```

This applies to both ESM (`import`) and CJS (`require()`) across `.ts` and `.js` files.

## Why

- **Clarity**: `node:fs` is unambiguous — it can never resolve to a third-party package named `fs`
- **SonarLint S7772**: Flags bare built-in imports as a code smell
- **Node.js recommendation**: The `node:` protocol is the official modern style (supported since Node 16)

## What we DON'T do

- **S7785 (top-level await)**: We keep `async function main()` + `main().catch(...)` for CLI scripts. The early-return pattern reads better than nested if/else chains when scripts have multiple bail-out conditions (--help, --list, validation). Suppress this rule.

## Common built-ins to prefix

`node:fs`, `node:path`, `node:os`, `node:url`, `node:crypto`, `node:child_process`,
`node:http`, `node:readline`, `node:stream`, `node:util`, `node:events`, `node:assert`
