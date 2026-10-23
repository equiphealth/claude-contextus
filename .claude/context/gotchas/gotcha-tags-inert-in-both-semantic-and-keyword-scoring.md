---
name: tags-inert-in-both-semantic-and-keyword-scoring
description: >-
  Confirmed at code level: tags are never embedded (chunk0 embedText) and never
  tokenized for BM25 keyword search — fully inert in both scoring paths, not
  just the planned CAE path
metadata:
  type: gotcha
  tags:
    - tags
    - retrieval
    - scoring
    - bm25
---

## Finding

The corpus's own docs describe tags as "inert until v2 CAE consumes them" (`skills/context-tag/reference.md`, `dev/CATEGORIES_AND_TAGS.md`) — framing it as waiting on ONE future consumer. Checked both of the project's actual, EXISTING scoring paths directly and confirmed tags are inert in both of them too, not just the not-yet-built CAE path:

- **Semantic embedding** (`lib/embedding/file-to-rows.ts`'s `buildRows`): only chunk 0 gets `embedText = [ctx.name, ctx.description, c.text].filter(Boolean).join('\n\n')`. `tags` is written to its own stored column (`tags: ctx.tags.join(',')`) but never appears in anything that gets embedded, for any chunk.
- **Keyword/BM25** (`lib/retrieval/keyword.ts`'s `keywordSearch`): `docTokensList = rows.map((r) => tokenize(r.document))` — only `document` (raw chunk text) gets tokenized/scored. `tags` is `select()`ed into the row by `loadCorpusForKeyword` but discarded for scoring purposes; it's loaded and never touched by `tokenize()`/`scoreBM25`.

So today a tag has literally zero effect on whether or how highly its file ranks in either retrieval path — it's pure storage/display metadata, full stop, regardless of CAE's timeline.

## Why this is worth fixing independent of CAE

Filed as [issue #101](https://github.com/equiphealth/claude-contextus/issues/101): feed tags into both existing paths (chunk-0 embedText concatenation for semantic; tokenize-and-score, likely as a boosted separate field rather than diluted into the BM25 document stream, for keyword) rather than only ever becoming meaningful once CAE's LLM-per-candidate evaluation exists. This reuses the exact precedent `implementation/implementation-hybrid-search.md` already documents — hybrid search exists specifically because short precise terms (`getLogger`) dilute in semantic embedding space but should win on exact match; a tag (`race-condition`, `deprecated`) is exactly that category of term.

It also partially answers #100's (CAE) open cost-model question: if tags already influence ranking before any LLM evaluation runs, that's a free pre-filter reducing how many candidates need the expensive Haiku-per-candidate pass.

## Dependency

Only worth doing once #96 (tags as a real `List<Utf8>` column) and #99 (tag quality/structural-dimension improvements) land — scoring against noisy, inconsistent, purely-topical tags won't help much.

