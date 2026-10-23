---
name: tiered-excerpt-depth-by-confidence
description: >-
  Design sketch for scaling injected excerpt length to match-confidence instead
  of full-body excerpts for every matched pattern
metadata:
  type: tradeoff
  tags:
    - injection
    - token-efficiency
    - retrieval
---

# Tiered excerpt depth by confidence

Currently when contextus injects multiple matched patterns above the floor, each one gets a full-body excerpt (roughly 200-800 tokens per match depending on section length) -- see the [contextus - N patterns matched] blocks this session for live examples. That cost scales linearly with topK regardless of how confident each individual match is.

## Proposed middle ground
Instead of all-or-nothing (full excerpt vs. title-only), use three tiers keyed to match confidence:

1. **Top match (highest score, above floor)**: keep the full-body excerpt as today -- this is the one match contextus is most confident is actually relevant, so paying the token cost to be self-contained is worth it.
2. **Other matches above floor**: replace the full excerpt with a short synopsis -- 1-2 sentences, the actual payoff/conclusion of the section, not the title alone and not the full markdown excerpt. Target ~30-60 tokens vs. 200-800. Still self-contained enough to act on without opening the file, but far cheaper.
3. **Below-floor "nearest topics" (gap-detected variant)**: stay pointer-only (filepath + score, no excerpt) -- this already happens today (see the retrieval-gap-detected footer format in API.md/lib/inject-format.ts) and is the right call since those are explicitly low-confidence/uncertain.

## Why this shape
- Confidence-tiering matches how the information is actually used: the top match is usually what action gets taken on, so it earns the expensive excerpt. Secondary matches are more often used for cross-referencing/awareness ("oh there's also a tradeoff doc about this") where a payoff sentence is enough to decide whether to go read the file.
- Avoids the two failure modes at the ends of the spectrum: title-only forces a file-open roundtrip to even know if a secondary match is relevant (defeats "finds you" proactive-delivery goal, see DESIGN.md); full-excerpt-for-everything over-pays tokens for matches the system itself ranked lower.
- Requires generating or precomputing a short synopsis per context file, distinct from both the title/description frontmatter field and the full body -- likely a new frontmatter field (e.g. `synopsis:`) populated at capture time (LLM-generated 1-2 sentence summary) or lazily on first retrieval, cached alongside the embedding.

## Open questions
- Where does the synopsis get generated -- at `/capture` time (adds latency/cost to every capture) or lazily cached on first use as a secondary match?
- Does `lib/inject-format.ts` need a formatting mode flag (full vs synopsis vs pointer) per match, selected by rank-within-results rather than a global config toggle?
- Should the synopsis respect the same floor/relative-separation logic described in decision-floor-calibration-signals.md (i.e. is "top match" by absolute score or by #1-vs-#2 gap)?

Related: [[tradeoff-staggered-decaying-reinjection]] (same token-reduction motivation, different injection axis -- that one is about reducing repetition across turns, this one is about reducing depth across simultaneous matches within one turn).

