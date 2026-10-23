---
name: ci-has-no-embedding-provider-fake-embed-test-seam
description: >-
  CI runs neither Ollama nor Transformers.js -- any integration test asserting a
  real successful embed via the live HTTP path fails there even though it passes
  locally; fixed via a CONTEXTUS_TEST_FAKE_EMBED env-var seam in embedder.ts
  that fakes only the model call
metadata:
  type: gotcha
  tags:
    - ci
    - testing
    - embedding
    - integration-test
---

## What happened

Two new integration tests (notify-logs-to-captures-log.test.ts, added on feat/capture-stop-hook-gate) asserted `embedded === true` through the real /notify HTTP path, spawning a real daemon as a separate OS process. Passed locally (dev machine had Ollama running), failed in CI every time with the response body `{continue:true}` instead of the expected `{ok:true, embedded:true}`.

## Root cause

CI (`.github/workflows/test.yml`) starts no embedding provider at all -- no Ollama service, no pre-cached Transformers.js model. `handleNotify()` has no local try/catch; when `embedSingleFile()`'s call to `embedDocument()` throws (ECONNREFUSED to Ollama, or a cold Transformers.js download that CI can't rely on), the exception propagates to a generic outer handler that degrades ALL hook-triggered endpoints to `{continue:true}` on any internal failure -- correct, intentional production behavior (never block a prompt), but it means "did the embed succeed" is unobservable from the HTTP response alone in an environment with no provider.

This exact constraint was already documented in `tests/integration/reconcile-multi-source.test.ts`'s header comment -- that file worked around it by testing `determineSource()` (pure routing logic) directly instead of asserting through the live HTTP path. The new test didn't follow that precedent.

## Fix: fake the model call only, keep everything else real

Added `CONTEXTUS_TEST_FAKE_EMBED=1`, read by `embedRaw()` in `lib/embedding/embedder.ts`. When set, returns a deterministic, L2-normalized pseudo-vector (hash-seeded LCG) instead of calling Ollama/Transformers.js. Everything else in `embedSingleFile()` -- content-hash staleness detection (`isStale()`), chunking, `deleteByFilename`/`upsertRows` against a real (tmpdir) LanceDB table -- still runs for real. The integration test sets this env var when spawning the daemon subprocess.

Why this is better than skipping the assertions or mocking the whole embedder module: the test still exercises genuine integration (real chunking, real staleness logic, real LanceDB writes, real `logCapture()` wiring) -- only the one step that needs a live model is faked, and it is faked in a way that preserves the shape (dimensions, normalization) real output has, so nothing downstream needs special-casing.

## Why NOT add this to lib/config.ts

Deliberately an env var, not a config option -- it must never be reachable via project/user config (that would risk a misconfigured production daemon silently emitting garbage vectors with no error). Env-var-only, read directly in embedder.ts, same pattern as the existing CONTEXTUS_NOMIC_PREFIXES test/debug toggle in the same file.

## Related

- tests/integration/reconcile-multi-source.test.ts header -- the prior art for "no embedding provider in CI" that this test should have followed from the start
- gotchas/gotcha-transformers-warmup-succeeded-on-dev-machine.md -- a separate finding from the same day that a dev machine CAN download the model fine; CI specifically cannot/does not, which is why this gap only shows up in CI, not locally

