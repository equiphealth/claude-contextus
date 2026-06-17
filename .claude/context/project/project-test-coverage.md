---
name: test-coverage-target
description: Target ~80% test coverage — cover exports, edge cases, failures; skip internal-helper obsession
metadata:
  type: project
  tags: [testing, standards, coverage]
---

**Test coverage target: ~80%**

Cover:
- All exported functions (happy path + key edge cases)
- Failure/fallback paths (network errors, bad input, missing config)
- Boundary conditions (empty arrays, threshold edges, max limits)

Skip:
- Obsessive coverage of private/internal helpers
- Testing trivial pass-through wrappers
- Mocking everything just to hit 100%

**Test style**: `node:test` + `node:assert/strict`. Mock `globalThis.fetch` for network tests. Use `describe()` for logical grouping. Keep tests fast (<5s total for the pure-logic suite).

**How to apply**: When adding a new module, write tests for the public API surface and failure modes. If the user flags a gap, address it — don't gold-plate.
