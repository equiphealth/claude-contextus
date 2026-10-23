---
name: context-tag-skill-enhancements-for-cae-rollout
description: >-
  Design tweaks for the /context-tag skill: append-mode for already-tagged
  files, file/list targeting, and a two-dimensional (topical + structural)
  tag-suggestion prompt
metadata:
  type: decision
  tags:
    - tagging
    - skills
    - cae
    - prompt-design
---

## Context

`/context-tag` (`skills/context-tag/reference.md`) is currently backfill-only: `--list` returns only TAGLESS files ("it only touches files that are still tagless" is explicit in the doc), and `--apply <relpath> tag1,tag2,tag3` takes exactly one file at a time. The subagent proposal prompt asks for "2-5 topical tags... from their actual content" with zero structural dimension. All three are limiting once tags actually matter (CAE consumption, issue #96's list-column work) rather than being inert seed data.

## Proposed tweaks

1. **Append mode, not just backfill.** Add a mode (new flag, or extend `--suggest`) that operates on files that ALREADY have tags, to propose additions — not just fill in files with zero tags. Today's `--list`/apply loop structurally assumes "no tags yet"; a file with 5 existing tags needs a different flow (see point 3's gap-framing).
2. **File/file-list targeting.** `--list` currently scans the whole corpus for tagless files; `--apply` takes exactly one relpath. Add the ability to pass a specific file or list of files (glob or explicit list) to operate on, instead of whole-corpus-or-single-file-only.
3. **Two-dimensional tag-suggestion prompt.** Root-caused via a live example (deep-link catalog retrieval miss, see `gotchas/gotcha-sparse-catalog-chunks-outranked-by-dense-adjacent-gotchas.md`): a tagging prompt that gives only topical example vocabulary (deep-links, urls, mobile-app, testing, android, ios, query-params, routing...) makes the model anchor entirely on "what is this about" and never consider "what kind of document is this." Fix: explicitly split the ask into two named dimensions with exemplars for BOTH:
   - **Topical** (subject matter): e.g. deep-links, urls, routing.
   - **Structural/document-shape**: e.g. catalog, checklist, how-to, troubleshooting, decision-log, reference-table. Ask the model to look at how the content is organized — flat list of items? step-by-step procedure? single incident writeup? comparison table? — not just what topic it covers.
   Naming "structural type" as its own category with its own exemplars is the key fix, not just asking for "more tags" — otherwise the model defaults to pure keyword extraction from body text.
4. **Raise the tag-count cap.** The current prompt caps at 2-5 tags total. With two dimensions now competing for slots, 2-5 forces the model to choose between topical and structural coverage rather than giving both room. Bump to ~4-7 so it can keep 2-3 topical tags and still fit 1-2 structural ones.
5. **Frame as "tags to ADD" when the file already has tags**, not "propose the full tag set." This makes the model reason about gaps relative to existing tags instead of re-deriving the whole set from scratch — relevant once (1) above exists, since an append-mode call is reasoning about a file that already has 5 tags, not a blank slate.

## Why this matters

Structural tags (e.g. `catalog`, `reference-table`) are exactly the kind of signal that could help the retrieval gap in `gotchas/gotcha-sparse-catalog-chunks-outranked-by-dense-adjacent-gotchas.md` once CAE consumes tags — a sparse, data-heavy catalog chunk that loses on raw semantic similarity to a denser narrative gotcha could still win on a structural-type-aware boost ("this is the canonical reference-table for the topic, surface it preferentially for structural/format questions"). None of that is possible if tagging only ever captures topical vocabulary.

## Scope / open questions

- Should land as part of, or right after, the #96 tags-as-list-column work — no point improving tag quality while tags are still comma-joined strings nothing reads.
- The lightweight Haiku subagent model (`skills/context-tag/reference.md`'s default) should be fine for the two-dimensional prompt too — it's still a small, bounded per-file task, just with a slightly richer rubric.
- Decide exact CLI surface for file/list targeting (glob flag vs. explicit relpath list vs. both).

