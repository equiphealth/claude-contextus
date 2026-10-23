---
name: embedding-provider-deployment
description: >-
  Tradeoffs between Transformers.js, local Ollama, network Ollama for embedding
  - includes empirically confirmed CDN-split root cause (huggingface.co vs
  cdn.hf.co) and the preflight check false-positive bug (GH #106)
metadata:
  type: tradeoff
  tags:
    - embedding
    - ollama
    - transformers
    - deployment
    - proxy
---

# Embedding Provider Deployment Modes

Three viable ways to run the embedding provider, each with distinct tradeoffs:

## 1. Transformers.js (in-process ONNX)

**Pro**: Zero external dependencies — model runs inside the Node process.
**Con**: First-run downloads ~130MB. Confirmed blocked on at least one corporate network — and now confirmed *why*, empirically (curl trace, 2026-10-23): `resolve/main/config.json` (small metadata) stays on `huggingface.co` itself, but `resolve/main/model.safetensors` (the actual weights) **redirects to a completely different domain** — HF's Xet storage backend at `*.cdn.hf.co` (e.g. `us.aws.cdn.hf.co`). A corporate proxy/gateway can allow `huggingface.co` entirely (web UI, API, small files) while blocking only the CDN host that serves large LFS/Xet-backed files. The web viewer page (`/blob/main/<file>`) loading fine is not evidence the download will succeed, because it never touches that CDN host at all.

**Related bug**: `lib/embedding/model-resolver.ts:80-98` (`isRemoteReachable`, used by `preflightTransformers`) only probes `resolve/main/config.json` — i.e. it never checks the CDN host that actually serves the model weights. On a network that blocks only `*.cdn.hf.co`, this check reports "reachable," setup proceeds, and the real failure surfaces later/deeper in the transformers.js pipeline with a worse, less actionable error than `modelUnavailableError()` would give. Filed as a GitHub issue.

| Failure mode | Symptom | Fix |
|---|---|---|
| TLS interception | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `NODE_EXTRA_CA_CERTS` or `trustProxy` config |
| CDN-only block (`*.cdn.hf.co`); `huggingface.co` itself fully reachable, including `resolve/main/config.json` | `isRemoteReachable()`/preflight passes (false positive — it only checks config.json); actual weights download fails deeper in the pipeline with a less actionable error | Trace the actual large-file download (not just config.json or a browser page load) to confirm the CDN host; pre-cache model off-network (`pnpm fetch-model`) or switch provider to Ollama |
| Offline (no cache) | Connection refused | Must have model in `~/.cache/huggingface/` |

Once cached, never touches network again. Ideal for: personal machines on clean WiFi, CI with pre-warmed caches.

## 2. Local Ollama (localhost:11434)

**Pro**: Localhost-only, zero network/proxy issues. Runs same nomic model. Hot-swappable models.
**Con**: User must install Ollama + pull the model (two manual steps).

Current shipped default in `plugin.jsonc` because it works universally regardless of network restrictions. The daemon's expansion pipeline also uses Ollama (qwen2.5:3b), so it's already a dependency for full functionality.

## 3. Network Ollama (shared instance)

**Pro**: One Ollama install serves an entire team. No per-machine setup beyond config.
**Con**: Network dependency, latency, single point of failure.

```jsonc
"providers": {
  "ollama": {
    "endpoint": "http://shared-host:11434"
  }
}
```

Ideal for: teams with a shared dev server, on-prem deployments where individual installs aren't practical.

## Decision Matrix

| Constraint | Best choice |
|---|---|
| Transformers.js download fails on corporate network (even if huggingface.co itself loads in a browser) | Local Ollama or network Ollama |
| Can't install system-level tools | Transformers.js (just needs Node) |
| Team deployment (many devs) | Network Ollama (one install, shared) |
| Fully offline / air-gapped | Transformers.js with pre-cached model |
| Zero-setup (home dev) | Transformers.js (auto-downloads) |

## Config

```jsonc
"embedding": {
  "provider": "transformers",        // or "ollama"
  "model": "nomic-ai/nomic-embed-text-v1.5",
  "ollamaModel": "nomic-embed-text", // used when provider=ollama
  "dimensions": 768,
  "transformers": {
    "localModelPath": "",             // absolute path skips download entirely
    "remoteHost": "https://huggingface.co/",  // changeable to any mirror
    "allowRemoteModels": true
  }
}
```

## Critical: switching providers requires re-embed

Different providers (even with the "same" model name) may produce incompatible vector spaces. Always run `pnpm embed` after changing provider. The table metadata sidecar records which provider was used — mismatch detection is planned but not yet implemented.


