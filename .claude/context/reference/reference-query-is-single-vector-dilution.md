---
name: query-is-single-vector-dilution
description: Retrieval embeds the WHOLE raw prompt as one mean-pooled vector — longer/multi-topic prompts dilute the signal, they don't match more. Specificity beats length.
metadata:
  type: reference
  tags: [retrieval, embedding, query, nomic, floor, v1.1, v2]
---

**How query embedding actually works (verified in code 2026-06-15):**
`query-hook.js` sends the **whole raw prompt, untruncated** → `daemon /query` →
`embedQuery(prompt)` (`search_query: ` prefix + full text) → ONE 768-dim mean-pooled,
L2-normalized vector. No splitting, no keyword extraction, no truncation.

**The counterintuitive consequence — a longer prompt does NOT match more results; it
usually matches *worse*:**
- Everything collapses to a single vector regardless of length. Similarity is the cosine
  angle between that one point and each stored chunk — not a word-by-word tally where
  more words = more chances to hit.
- **Mean-pooling makes longer prompts blurrier.** A focused prompt ("how do I log in
  automation?") yields a sharp vector aimed at one region. A multi-topic prompt
  ("refactoring checkout, also the logger, plus BrowserStack was flaky, and check the
  iOS selectors") averages 4 topics into a mushy centroid pointing strongly at none —
  so top similarity to any single-topic pattern *drops*.
- The `injectionFloor` gates raw similarity per chunk and `topK` caps the count, so a
  sprawling prompt can inject **fewer** patterns, not more. Dilution, not accumulation.

**Practical rule:** specificity beats length. A short, on-topic prompt is the strongest
retrieval signal. This is by-design for nomic-style asymmetric embedders (short
`search_query:` matched against longer `search_document:` passages).

**Implication (the multi-topic worst case):** the single-vector approach serves a
genuinely multi-topic prompt *worst* — the one pattern the user most needs gets averaged
away. This is the motivation for **query transformation** before embedding — see
V2_ROADMAP. The fix family (cheapest→richest): recency-weight the latest turn → strip
boilerplate → embed sub-spans separately and union results → LLM query rewrite (HyDE).
The catch: transformation runs in the latency-critical UserPromptSubmit path (5s hook
budget), so an LLM rewrite competes with the CAE cost-model tension; deterministic
trims/multi-span are the v1.1-plausible ones.

**Related:** the floor calibration story ([[decision-floor-calibration-signals]]) and the
v2 relative-separation gate both assume the current single-vector behavior.
