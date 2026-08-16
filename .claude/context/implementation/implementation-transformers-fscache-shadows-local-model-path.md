---
name: transformers-fscache-shadows-local-model-path
description: FIXED: configureTransformersEnv() disables useFSCache/useBrowserCache when localModelPath is set, so a stale bad cached response can no longer shadow a correctly-bundled local model
metadata:
  type: implementation
  tags: ["transformers", "embedding", "offline"]
---

## What Changed

`configureTransformersEnv()` (`lib/embedding/model-resolver.ts`) now sets `env.useFSCache = false` and `env.useBrowserCache = false` whenever `embedding.transformers.localModelPath` is configured.

## Root Cause (see also the archived gotcha this supersedes)

transformers.js's `getModelFile` (`node_modules/@xenova/transformers/src/utils/hub.js`) checks its filesystem/browser cache BEFORE the `localModelPath` lookup. If an earlier attempt on a network that blocks huggingface.co (corporate proxy, captive portal, Cloudflare Gateway — see `tradeoffs/tradeoff-embedding-provider-deployment.md`) cached a bad HTML block-page response, every subsequent load — even one correctly configured with `localModelPath` and `allowRemoteModels: false` — silently served that stale cached response instead of ever consulting the real bundle. `env.allowRemoteModels = false` didn't help: that flag only gates the network-fetch fallback, which was never reached because the cache lookup already "answered" first.

Compounding this, `lib/embedding/embedder.ts`'s `getPipeline()` catch handler pattern-matches on the error message to decide whether to rethrow as the actionable `modelUnavailableError` (`/fetch|JSON|Unexpected token|ENOTFOUND|ECONNREFUSED|certificate/i`). The stale-cache failure throws `SyntaxError: Unexpected token '<' ... is not valid JSON` (an HTML page where JSON was expected) — which matches that regex, so it got rewritten into the generic "model isn't bundled locally... unreachable" message. That message's own suggested fix — "pre-fetch a bundle on an unblocked network, then point `localModelPath` at it" — is exactly the scenario that still failed, with no indication the real problem was an unrelated stale cache entry rather than the bundle itself.

## Fix

```ts
if (t.localModelPath) {
  env.localModelPath = t.localModelPath;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.useBrowserCache = false;
}
```

No cost to the normal remote-download-with-cache path — this only takes effect when a local bundle is explicitly configured, a scenario with no remote downloads to cache in the first place.

## Tests

`tests/manual/transformers-local-model.test.ts` — a MANUAL, non-CI test (lives outside both `tests/*.test.ts` and `tests/integration/*.test.ts` globs) that drives contextus's own `embedder.ts`/`model-resolver.ts` code (via a throwaway `CLAUDE_PLUGIN_ROOT`/`plugin.json`, not the raw `@xenova/transformers` API) against a real local model bundle (`assets/model/`, gitignored, extracted from `assets/model.zip`). Verified the fix is load-bearing by reverting it and re-running: reproduces the exact `modelUnavailableError` even though the bundle is present, confirming the bug and the fix.

Why manual/non-CI: requires a ~132MB local model bundle (the `quantized` ONNX variant only) that isn't checked into the repo and isn't available in CI. Nothing in the automated suite exercised the `transformers` provider end-to-end before this — only `ollama` had real coverage, since it needs no network download.

Superseded gotcha: `gotchas/gotcha-transformers-fscache-shadows-local-model-path.md` (archived via `/delete` in the same commit as this fix, per the bug-documentation lifecycle).
