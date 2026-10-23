---
name: sparse-catalog-chunks-outranked-by-dense-adjacent-gotchas
description: >-
  Real cross-session retrieval failure: the deep-link URL catalog, the file most
  relevant to a path-format change, wasn't injected while narrower
  testing-mechanics gotchas on an adjacent subtopic scored high enough to inject
  instead
metadata:
  type: gotcha
  tags:
    - retrieval
    - calibration
    - chunking
    - scoring
---

## Observed failure (reported from a separate automation-repo session, 2026-10-21)

Prompt: "Oh I learned some new details about deep links. The path fragment /mobile-app/ is optional now. We should update our existing context for that..."

This is squarely a question about `reference/reference-deep-link-url-catalog.md` (the catalog of actual deep-link URLs, which literally contain `/mobile-app/`). Contextus instead injected five OTHER deep-link patterns — `gotcha-sub-deeplink-format-is-query-param-not-path.md`, `gotcha-deep-link-host-must-match-build-env.md`, an ADB query-param-escaping gotcha, a testing-workflow checklist, and `reference-deep-link-test-results.md` — all about testing *mechanics* (how to trigger/verify a deep link), not the URL path-structure question actually being raised. The catalog itself never made the cut that turn. The agent in that session initially claimed the catalog HAD been injected (confabulated from having `ctx_read` it directly moments earlier, not from contextus's own retrieval) and only caught the error when the user pushed back and asked directly — a false "yes it was injected" is a worse failure mode than a silent miss, since it masks the real gap from auto-calibration/usage-eval signals too.

## Root-cause hypothesis

Per `lib/embedding/file-to-rows.ts`'s `buildChunks`: only chunk 0 of a file gets its embedding boosted with `[name, description, text].join('\n\n')` — every later chunk embeds on raw chunk text alone. The catalog's chunk 0 (visible in this session's own injection of the same file at 0.74 similarity) is almost entirely a "see also" index pointing to sibling docs, not the actual URL list. The real catalog data — the literal URLs containing `/mobile-app/` — most likely lives in a later, un-boosted chunk that's dense with raw URLs and sparse on descriptive prose. That gives it weak semantic surface area against a prompt phrased in natural language ("is the path fragment optional").

Meanwhile `gotcha-sub-deeplink-format-is-query-param-not-path.md` is rich narrative prose explicitly about URL *path structure* — "query-param style, not path-style" — which overlaps heavily with the vocabulary of a path-format question, even though it answers a different, adjacent question (param style vs. fragment optionality). It outranked the actually-relevant file by being denser and more narratively on-topic in generic "deep link URL format" terms, not because it was more correct for this specific question.

## Generalizable lesson

Sparse, data-heavy reference/catalog chunks (raw URL lists, tables, enumerations) are structurally disadvantaged against dense narrative gotchas on an adjacent subtopic — even when the catalog is the file that actually needs to be acted on. This isn't specific to deep links; it'll recur for any catalog/table-style reference doc whose substance is low-prose data rather than descriptive sentences.

## Possible mitigations (not yet decided/built)

- Give catalog-style chunks richer per-chunk context, not just chunk-0 boosting — e.g. repeat the file's name/description into every chunk's embedText, not only the first.
- Once tags are a real, CAE-consumed signal (see issue #96's `List<Utf8>` work and `dev/CONTEXT_APPLICABILITY_EVALUATOR.md`), a `reference`/`catalog` tag could carry a scoring nudge for structural/format-style queries specifically.
- `/context-calibrate --floor` replay against this exact prompt would show whether this was a floor-threshold miss (catalog scored just under 0.7, as its own chunk-0 did on THIS unrelated prompt at 0.74) or a reranking-order miss (catalog scored above floor but lost to the 5 gotchas on topK cutoff) — worth running before picking a fix, since the two failure modes call for different remedies (floor tuning vs. chunk-density fix vs. topK width).

## Why this is worth tracking in contextus itself

This is a concrete, reproducible instance of exactly the kind of retrieval gap `/context-calibrate`'s usage-eval work is meant to catch — but it was caught by direct user pushback in a live session, not by any existing calibration tooling. Worth treating as a seed case the next time usage-eval/floor-replay work resumes.

