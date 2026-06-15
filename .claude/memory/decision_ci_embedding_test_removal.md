---
name: ci-embedding-test-removal
description: Removed Ollama embedding smoke test from GitHub Actions CI for speed; local dev already validates full pipeline
type: decision
---

# CI: Embedding Smoke Test Removed

Removed the embedding smoke test from the GitHub Actions CI workflow (2026-06-15, post-v1).

**Why:** The test required Ollama installation + nomic-embed-text model download on every PR, adding significant time (minutes) with minimal validation benefit. Local dev already runs the full embedding pipeline, and the remaining CI checks (lint, type-check, unit tests, build) cover code quality.

**What remains in CI:**
- ESLint (code quality)
- TypeScript type-check
- Unit tests (pure-logic, no model load)
- Build verification (dist/ output)

**What was removed:**
- Ollama setup
- nomic-embed-text model pull
- `pnpm run embed` smoke test

**When to revisit:** If embedding integration breaks in ways unit tests don't catch, consider adding it back as an optional/scheduled job (nightly or weekly), not on every PR.

**Related:** Release workflow still runs the full test suite before publishing.
