---
name: embedding-provider-switch
description: Switching embedding provider/model (e.g. ollama→transformers) is a full re-embed, not a config flip — the daemon refuses to inject on a corpus/config mismatch
metadata:
  type: gotcha
  tags:
    - embedding
    - ollama
    - transformers
    - corpus
    - reembed
---

**Switching embedding provider or model is a RE-EMBED, not a config flip.** Each project
table stores its build-time provenance in `<table>.meta.json` (`provider`,
`embeddingModel`, `dimensions`). On EVERY query the daemon compares that against the
active config (`daemon/server.ts` ~164):

- **Model-id mismatch** → logs an error, returns `{continue:true}` → **no injection**
  (graceful degrade; a mismatched space yields garbage similarities).
- **Dimension mismatch** → same.

**The ollama→transformers trap specifically:** both run nomic at 768 dims, so the
DIMENSION check passes — but the stored model id is `nomic-embed-text` (ollama) vs active
`nomic-ai/nomic-embed-text-v1.5` (transformers), so the MODEL-ID check fails → silent
dead corpus (injections just stop, reason only in `daemon.log`). And even if ids matched,
the two providers don't emit identical vectors (tokenization/pooling/normalization
differ), so you MUST re-embed regardless.

**The fix:**
```bash
# 1. ensure the new provider's model is available (transformers = HF download,
#    may be network-blocked — see project-embedding-download-risk)
# 2. set embedding.provider in config (per-project tier if only this project)
# 3. full rewrite (every vector changes space — use --rebuild, not incremental):
cd ~/src/claude-contextus && pnpm rebuild
# 4. restart the daemon so it loads the new config:
kill $(cat ~/.contextus/runtime/daemon.pid)   # respawns next session
```

Multi-project: each `~/.contextus/data/<project>/` is independent — repeat per corpus.
Nothing automates this yet (DEFERRED.md: a `/contextus-reembed --provider` would do
config-write + rebuild + restart in one step).
