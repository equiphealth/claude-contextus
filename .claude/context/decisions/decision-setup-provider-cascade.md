---
name: setup-provider-cascade
description: Setup wizard tries transformers.js first, falls back to Ollama with assisted install
metadata:
  type: decision
---

Provider Detection Cascade

Setup wizard attempts providers in order of decreasing zero-config viability:

1. Transformers.js (zero deps) - attempt HF model download. Success = done. Blocked (corporate proxy) = fall through.

2. Ollama (assisted install) - if transformers fails: detect binary (which ollama), guide install if missing, start server if not running, pull model automatically (ollama pull nomic-embed-text), verify embedding works.

Principle: Contextus handles everything after binary install. User never needs to know model names, endpoints, or dimensions. One confirmation and we do the rest.

What we handle: model pull, server lifecycle, config generation, verification.
What we do not handle: binary installation (platform-specific, guide only), GPU drivers, port conflicts (detect and report).

Open: verify transformers.js works reliably on coworker machines before committing to this cascade order.
