---
name: transformers-fscache-shadows-local-model-path
description: transformers.js checks its filesystem cache (env.cacheDir) before env.localModelPath — a stale cached bad response silently wins over a real local bundle
metadata:
  type: gotcha
  tags: ["transformers", "embedding", "offline"]
---

## Symptom

Setting `env.localModelPath` + `env.allowLocalModels = true` + `env.allowRemoteModels = false` on `@xenova/transformers`'s global `env`, then calling `pipeline('feature-extraction', modelId, {quantized: true})` against a real local model bundle, still threw:

```
SyntaxError: Unexpected token '<', "
<!DOCTYPE "... is not valid JSON
```

— i.e. it received an HTML page (a captive-portal / gateway block page) where it expected `config.json`, despite `allowRemoteModels` being false and a valid local bundle sitting at the configured `localModelPath`.

## Root Cause

`hub.js`'s `getModelFile` (the internal fetcher every model file load goes through) checks the **filesystem/browser cache first**, and only falls through to the `localModelPath` lookup if there's no cache hit:

```js
// simplified from node_modules/@xenova/transformers/src/utils/hub.js
if (cache) {
  response = await tryCache(cache, localPath, proposedCacheKey); // <-- checked FIRST
}
if (response === undefined) {
  if (env.allowLocalModels) {
    response = await getFile(localPath); // <-- localModelPath lookup, SECOND
  }
  ...
}
```

If an earlier real download attempt on this machine happened on a network that blocks huggingface.co (corporate proxy, captive portal, Cloudflare Gateway — see `tradeoffs/tradeoff-embedding-provider-deployment.md`), the resulting HTML block page can get written into the FileCache (`env.cacheDir`, default `./.cache/` or similar) under a cache key that matches. Every subsequent load — even one correctly configured to use `localModelPath` and never touch the network — silently serves that stale bad cached response first, before `localModelPath` is ever consulted. `env.allowRemoteModels = false` doesn't help here because the cache lookup doesn't check `allowRemoteModels` at all; that flag only gates the network-fetch fallback path, which is never reached because the cache already "answered".

## Fix

Disable the caches explicitly when you want `localModelPath` to be authoritative:

```ts
import { env } from '@xenova/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/path/to/bundle';
env.useFSCache = false;       // <-- forces the local-path lookup to actually run
env.useBrowserCache = false;  // <-- N/A in Node, but harmless to set for parity
```

## Why This Matters

This makes the failure mode *look* like "the local bundle setup is wrong" (wrong path, wrong modelId subfolder, corrupted files) when the bundle is actually fine — the real problem is an unrelated stale cache entry from a prior, unrelated failure. Anyone debugging a `localModelPath` setup that "should work" but throws an HTML-parse error should check `env.cacheDir` for a bad cached response before re-checking the bundle itself.

Found while writing `tests/manual/transformers-local-model.test.ts` — a temporary, non-CI test verifying the `transformers` embedding provider actually works end-to-end offline (nothing in the automated suite exercised it before; Ollama is the only provider CI can test without a network dependency).
