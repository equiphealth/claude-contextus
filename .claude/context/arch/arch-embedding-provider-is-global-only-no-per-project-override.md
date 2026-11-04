---
name: embedding-provider-is-global-only-no-per-project-override
description: >-
  There is no per-project embedding provider override at any config tier --
  embedder.ts reads only the global config
metadata:
  type: arch
  tags:
    - embedding
    - config
    - architecture
---

**Fact**: `lib/embedding/embedder.ts` calls `loadConfig()` exclusively at every call site (pipeline init, warmup, raw embed, Ollama embed) -- never `loadProjectConfig()`. There is exactly one loaded model process-wide, serving every project's corpus from the same daemon.

**Implication**: writing `embedding.*` into ANY project-scoped config file -- `.claude/contextus.jsonc` (tier-3, git-committed) or `~/.contextus/data/<project>/config.json` (tier-2, machine-local) -- is silently ignored by the actual embed call. This is worse than an error: `/configure show` or `loadProjectConfig()` would report a provider that isn't actually what's computing embeddings, so tooling built on the project-merged config (setup wizards, status dashboards) would lie about reality.

**Corollary bug this caused**: `daemon/server.ts`'s query-time embedding mismatch check used to read `loadProjectConfig()` for the "active model" comparison, while the real embed call used `loadConfig()`. A stale per-project override that happened to still match the OLD corpus meta would pass the check while the daemon actually embedded live queries with a DIFFERENT model -- silently injecting garbage similarities with no error logged, bypassing the exact safety check meant to catch this. Fixed by making the mismatch check read `loadConfig()` too (see implementation-embedding-mismatch-check-wrong-config-source.md).

**How to apply**: never suggest or document a per-project embedding provider override. Changing the provider for real is a machine-wide migration: edit `plugin.jsonc`'s `embedding` block directly, restart the daemon, then `/rebuild-embeddings --full` for every project + user scope on the machine -- not a `/configure set` or setup-wizard config write. `skills/configure/reference.md` and `skills/contextus-setup/reference.md` both document this explicitly now (2026-11-01 fix).
