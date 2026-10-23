---
name: embedding-provider-switch
description: >-
  Switching embedding provider/model is a full re-embed, not a config flip --
  AND re-embedding alone does not fix the hardcoded nomic task-prefix
  assumption, which silently degrades quality on non-nomic models with no error
metadata:
  type: gotcha
  tags:
    - embedding
    - ollama
    - transformers
    - corpus
    - reembed
    - prefixes
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

**Re-embedding does NOT fix the nomic task-prefix problem, and nothing will warn you.**
`embedder.ts:37-40` (`prefixesEnabled()`) unconditionally prepends `search_document: ` /
`search_query: ` to every embedded string, regardless of which model is configured — it's
hardcoded for nomic's instruction-tuned retrieval scheme, not model-aware. If you switch
`embedding.model` to a *different* model family (e.g.
`sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2`, which wasn't trained with
those prefixes) and do a correct re-embed per the steps above: dimensions will be
consistent (once you also update `embedding.dimensions` to match the new model),
model-id will match, the daemon's mismatch checks both pass, injection proceeds
normally — and every vector is quietly polluted with prefix text the model doesn't know
how to use. This degrades retrieval quality silently; there is no error, log line, or
mismatch check that catches it, because from the daemon's point of view everything is
consistent. The only escape hatch is the undocumented env var
`CONTEXTUS_NOMIC_PREFIXES=0`, which is global/all-or-nothing (not per-model) and isn't a
config.json field. Treat "same embedding provenance checks pass" as necessary but NOT
sufficient evidence that a model swap is safe — also check whether the new model expects
the same instruction-prefix convention nomic does.

