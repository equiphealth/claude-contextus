---
name: hook-files-esm-and-smoke-test
description: Hook .js files must be ESM (repo is type:module) AND be smoke-tested by executing the file via stdin, not just unit-testing imported functions
metadata:
  type: gotcha
  tags: [hooks, esm, testing, phase-6]
---

**What happened (2026-06-14)**: The Phase-5 Stop hook (`scripts/stop-evaluation.js`) was written with CommonJS `require('fs')`. The repo is `"type": "module"`, so Node treated the `.js` as ESM and threw `ReferenceError: require is not defined in ES module scope` on the **first real fire in a live session** — after the phase was reported "done" and committed.

**Two distinct lessons:**

1. **Hook files MUST be ESM.** Every hook in `scripts/` is plain `.js` run via bare `node` (no build step), and the repo is `type: module`. Use `import`, never `require`. Match the sibling hooks (`query-hook.js`, `watch-contexts.js`, `session-start-hook.js`) — they're all ESM. The daemon-side `.ts` libs run via tsx; hooks can't import them, so hooks read shared state files (`~/.contextus/...`) directly.

2. **Unit-testing the LOGIC ≠ testing the ENTRY POINT.** The worker core had a green unit test (`eval-worker-core.test.ts`) with a mocked model caller — it proved parse/score/queue logic but **imported functions, it never loaded the hook file**, so the module-scope `require` error had no chance to surface. A passing logic test gave false confidence.

**Why:** an entry-point file can be broken (bad module syntax, wrong shebang, missing import) in ways that importing its inner functions never exercises. The failure mode lives in *loading the file as the runtime loads it*, not in calling its functions.

**How to apply:**
- For any hook/script entry point, **execute the file the way the harness does** — pipe a realistic payload to stdin and run `node scripts/<hook>.js`, assert clean load + exit + expected side effect. Do this IN ADDITION to unit-testing the logic, not instead.
- **Phase 6's "integration tests for daemon + hooks" must run each hook file via stdin** (both relevant states, e.g. calibration on/off), not just import-and-call. Bake this in.
- Quick manual smoke before declaring a hook done: `echo '<payload>' | node scripts/<hook>.js; echo $?`.

**Related**: [[evaluation-architecture]], [[selfdoc-build-practice]]
