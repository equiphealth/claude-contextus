---
name: expansion-ruled-out-for-em-dash-retrieval-discrepancy
description: >-
  Correcting a hypothesis: a 0.66-live vs 0.7174-direct-search score gap for the
  same file was attributed to query expansion, but threshold math shows
  expansion couldn't have fired
metadata:
  type: gotcha
  tags:
    - retrieval
    - expansion
    - debugging
---

## The reported discrepancy

In a separate session (automation repo), a user-preference file (`reference-avoid-em-dash-in-external-communications.md`, user-scope) failed to inject on two real prompts ("write this external support email," "make sure it doesn't sound ai-written") — live hook reported best scores of 0.65 and 0.66, both below the 0.70 floor. A follow-up direct `/search` call with "essentially the same phrasing" scored the same file's top chunk at 0.7174 — above the floor. The session hypothesized this pointed at a bug in query expansion's union/max-aggregation step (either not including the original query's own results, or broken max-vs-average aggregation across variants), reasoning that expansion should only ever help or stay neutral, never hurt, so a lower live score than a direct search implied something in that step was suppressing a genuinely good match.

## Why that hypothesis doesn't hold up

Checked the actual pipeline code (`daemon/server.ts`'s query handler + `lib/retrieval/expand.ts` + `lib/retrieval/hybrid.ts`) rather than accepting the hypothesis from the transcript alone:

1. **`/search` and the live `/query` path start from the identical `search()` primitive** — `/search` (`daemon/server.ts:1657`) is pure `embedQuery` + `search()`, no hybrid, no expansion, no RRF. The live path's `raw = await search(vec, fetchLimit, ...)` is the same base call, before any hybrid/expansion layering.
2. **Expansion's default `expansionThreshold` is 0.55** (`lib/config.ts:342`), and adaptive mode (the default) only fires `shouldExpand` when `initialBest < threshold`. The live hook's reported best was 0.65-0.66 — already ABOVE 0.55 — so expansion almost certainly never fired for either of those two prompts. A step that didn't run can't be the cause of a score discrepancy.
3. **Even when hybrid fusion does run, it doesn't shrink a real semantic match's score.** `fuseRRF` (`lib/retrieval/hybrid.ts`) explicitly preserves the original semantic `similarity` for any result that has a semantic rank (`sRank !== null`) — it only ever halves a score for a PURE keyword-only hit with no semantic rank at all (a safeguard against RRF's rank-based ordering being mistaken for a real relevance signal, per the function's own comment: "the injection floor must gate on actual vector relevance").

## Actual likely explanation

The two compared prompts were not byte-identical text ("essentially the same phrasing," explicitly not exact). Cosine similarity between a query embedding and a stored chunk is sensitive to exact wording — a ~0.05-0.06 delta between two close paraphrases, one landing just above a 0.70 floor and one just below, is normal embedding variance near a threshold, not evidence of a pipeline defect. This actually reinforces the ORIGINAL, correct diagnosis from that session (semantic retrieval near the floor is phrasing-sensitive, lexical/conceptual overlap matters) rather than revealing a second, separate expansion bug.

## Lesson for future debugging

Before attributing a retrieval discrepancy to a specific pipeline stage (expansion, hybrid, reranking), check whether that stage's own trigger condition would even have fired for the specific scores observed — `shouldExpand`'s threshold check here immediately ruled out the leading hypothesis without needing to trace deeper into the union/aggregation logic at all. Threshold math first, implementation details second.

