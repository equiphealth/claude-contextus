---
name: embedding-mismatch-check-used-wrong-config-source
description: >-
  FIXED: daemon query-time embedding mismatch check compared corpus meta against
  project-merged config while the real embed call uses only global config
metadata:
  type: implementation
  tags:
    - embedding
    - daemon
    - config
    - bugfix
---

**Bug**: `daemon/server.ts`'s `handleQuery` validated query-time embedding space against build-time space using `loadProjectConfig(projectId, cwd)` (the full 3-tier merge). But `lib/embedding/embedder.ts`'s `embedQuery()` -- the function that actually computes the live query's vector -- reads only `loadConfig()` (global, no project awareness). These two can disagree whenever a project has ANY embedding override in tier-2 or tier-3 config.

**Why this is worse than a normal bug**: the mismatch check exists specifically to catch build-time vs query-time embedding space drift and degrade gracefully (return `{continue:true}`, no injection) rather than inject garbage similarities from mismatched vector spaces. But because the check used the WRONG config source, a stale per-project override that happened to still match the OLD corpus meta would PASS the check -- while the daemon's real embed call used a DIFFERENT model (whatever `loadConfig()` globally resolves to). Result: silent garbage-similarity injection with zero error logged, bypassing the one safety net meant to prevent exactly that.

**Confirmed live** (2026-11-01): this exact scenario happened on contextus's own dogfood project -- its `.claude/contextus.jsonc` (tier-3) still declared `provider: "ollama"` after the global default was flipped to `transformers`, while the corpus had already been rebuilt as transformers. The mismatch check (using project-merged config) detected "ollama vs transformers" as a mismatch and correctly blocked injection -- but for subtly the wrong reason (it should never have considered "ollama" a candidate at all, since nothing can actually embed with it per-project).

**Fix**: `daemon/server.ts` now reads `const embeddingCfg = loadConfig().embedding` (global) for the mismatch check specifically, while keeping `loadProjectConfig()` for everything else that genuinely is project-scoped (retrieval floor/topK, expansion, etc). See arch-embedding-provider-is-global-only-no-per-project-override.md for why embedding specifically can never be project-scoped.

**How to apply**: any new per-query validation logic must read config from the SAME source the thing it's validating actually uses. Don't assume "project-aware" is always the more-correct choice -- for a resource that's architecturally global (one daemon, one loaded model), project-awareness in the check is itself the bug.
