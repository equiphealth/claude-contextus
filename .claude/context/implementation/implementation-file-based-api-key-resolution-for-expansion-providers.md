---
name: file-based-api-key-resolution-for-expansion-providers
description: >-
  API keys for cloud expansion providers (meta, anthropic) can be resolved from
  a file path instead of an inherited env var, surviving daemon restarts
  regardless of what spawned them
metadata:
  type: implementation
  tags:
    - security
    - credentials
    - expansion
    - daemon
---

**Problem solved**: the daemon's process environment is fixed at spawn time. A key exported to a shell after the daemon started -- or inherited from whatever launched it (IDE, hook, CLI) -- is invisible to a running daemon regardless of mechanism. The SessionStart hook respawn path doesn't help either: it inherits the IDE's environment, not the user's shell.

**Fix**: `lib/config.ts` adds `readApiKeyFile(filePath): ApiKeyFileResult` -- a discriminated union (`{ok:true,key}` or `{ok:false,reason:"not-found"|"unreadable"|"empty",path}`) that reads a key from disk live, so rotation is just "edit the file" with no restart-source dependency. Never logs or returns file contents on failure -- only a reason + path. Warns (stderr, not thrown) if the file is group/world-readable.

`MetaProviderConfig`/`AnthropicProviderConfig` both gained an optional `apiKeyFile` field. `lib/retrieval/expand.ts`'s `resolveMetaApiKey()`/`resolveAnthropicApiKey()` check it first, win over the env var when configured -- and critically, a configured-but-BROKEN file throws a specific, path-naming error rather than silently falling through to env vars. That silent-fallthrough would otherwise make a misconfigured key invisibly degrade to the fallback provider (e.g. Bedrock instead of Meta), which looks identical to "everything's fine" from inside a session.

**Transparency**: `ExpandedQueries` carries an optional `warning` field for this exact case. `daemon/server.ts`'s `/query` handler surfaces it into the actual model-visible response (the inject block, the near-miss notice, AND the previously-bare no-inject `{continue:true}` path) -- not just `daemon.log`. A log line alone isn't enough when nobody's tailing logs during a live demo.

**Setup carve-out (not yet implemented, needed)**: setup must treat a key file path like credential enrollment -- validate existence/readability/non-emptiness WITHOUT ever displaying contents, never log it, never let it enter a `/capture` payload.
