---
name: eslint-configuration
description: ESLint rules adopted from automation project for code quality
type: implementation
category: tooling
---

# ESLint Configuration

Adopted production-tested rules from another project's automation suite before bulk implementation.

## Promise Handling (Critical)

```json
"@typescript-eslint/await-thenable": "error",
"@typescript-eslint/no-floating-promises": "error",
"@typescript-eslint/no-misused-promises": "error",
"@typescript-eslint/require-await": "warn"
```

**Why**: Daemon handles async HTTP + DB operations. These rules catch unhandled promise rejections and prevent awaiting non-promises.

## Code Style

- `lines-between-class-members`: Visual breathing room
- `padding-line-between-statements`: Blank lines between functions/blocks
- `object-curly-spacing`: `{ foo }` not `{foo}`
- `max-len`: 100 char (matches prettier)
- `max-lines`: 500 line warning

## Import Ordering

```json
"import/order": ["error", {
  "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
  "newlines-between": "never",
  "alphabetize": { "order": "asc", "caseInsensitive": true }
}]
```

## What We Skipped

- WDIO plugin (test framework specific)
- `no-restricted-imports` (project-specific boundaries)

## When Applied

June 12, 2026 — before daemon implementation, while code is still scaffolding.

124 violations in early placeholder code (resolved during the ChromaDB→LanceDB migration).
