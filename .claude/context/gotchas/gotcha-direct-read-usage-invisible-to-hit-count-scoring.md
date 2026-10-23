---
name: direct-read-usage-invisible-to-hit-count-scoring
description: >-
  hit_count only increments via the UserPromptSubmit retrieval pipeline; direct
  Reads of context files are invisible to reranker/scoring until issue #97
metadata:
  type: gotcha
  tags:
    - scoring
    - hooks
    - retrieval
    - hit-count
---

## Gap

`hit_count`/`last_hit` on a `ContextRow` are only ever incremented via `incrementHits` (`lib/storage/lance-client.ts:297`), and that function is only ever called from `handleQuery` in `daemon/server.ts` — i.e. only when the automatic `UserPromptSubmit` retrieval pipeline actually injects a pattern into a response.

Any other way a context file gets used — a direct `Read`/`ctx_read` by the agent, opening it via `/context-search`, or consulting it outside the auto-injection path — is completely invisible to this counter. `retrieval/reranker.ts`'s `hitCountBoost` and `introspect.ts`'s corpus stats both undercount real utility for patterns used this way.

Confirmed: `/notify` (what `scripts/watch-contexts.js` calls on Write/Edit today) never touches `incrementHits` — correct, since editing a file isn't "using" it, but it means there's currently no path at all for Read-driven usage to register.

## Why it matters

This project already treats hit counts as the core usage-ratchet signal (surfaced directly in injected chunks — "used N×" — see `retrieval/inject-format.ts`). An undercounted signal quietly skews the reranker toward over-favoring auto-injected patterns and under-favoring patterns that are genuinely useful but tend to get consulted by direct lookup instead.

## Fix direction

The `Read` matcher already being discussed for `scripts/watch-contexts.js` (see `gotchas/gotcha-sourcefile-metadata-needs-new-posttooluse-capture-nudge.md` — scoped to `.md`/context paths only, to avoid firing on every exploratory code read) is the natural place to also drive this. It needs:
- A relPath → chunk-row-IDs lookup (chunks are `${ctx.id}#${chunkIndex}`; today they're only addressed by ID inside the retrieval path where the IDs come from the query result already).
- A way to call `incrementHits` for those IDs outside the query path — either a flag on `/notify` or a new minimal endpoint, since `/notify`'s current job (re-embed) is unrelated to usage tracking.

## Tracking

Filed as [GitHub issue #97](https://github.com/equiphealth/claude-contextus/issues/97).

