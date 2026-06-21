---
name: embedding-provider-deployment
description: Tradeoffs between Transformers.js (zero-dep), local Ollama, and network Ollama for embedding — includes corporate proxy gotchas
metadata:
  type: tradeoff
  tags: [embedding, ollama, transformers, deployment, proxy]
---

# Embedding Provider Deployment Modes

Three viable ways to run the embedding provider, each with distinct tradeoffs:

## 1. Transformers.js (in-process ONNX)

**Pro**: Zero external dependencies — model runs inside the Node process.
**Con**: First-run downloads ~130MB from huggingface.co. Blocked by corporate proxies that deny HF domain.

| Failure mode | Symptom | Fix |
|---|---|---|
| TLS interception | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` | `NODE_EXTRA_CA_CERTS` or `trustProxy` config |
| Domain block (Cloudflare Gateway) | HTML block page, not cert error | Pre-cache model off-network or switch provider |
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
| Corporate proxy blocks HF | Local Ollama or network Ollama |
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
