---
name: floor-calibration-signals
description: Empirical findings from Phase-1 retrieval that should seed Phase-5 floor calibration — the 0.7 default is wrong for ollama-nomic, and relative separation beats an absolute threshold
metadata:
  type: decision
  tags: [calibration, retrieval, floor, embedding, phase-5]
---

**Context**: `pnpm query` (scripts/search.ts) lets us spot-check retrieval against the live 3-file corpus before Phase 5 builds the calibration harness. Several runs surfaced concrete signals about the `similarityThreshold: 0.7` floor.

**Findings (ollama nomic-embed-text, 768-dim, `search_query:`/`search_document:` prefixes)**:

1. **The 0.7 default is definitively wrong for this provider.** Correct top hits land **0.50–0.68** even when retrieval is obviously right. A hard 0.7 floor would suppress *good* matches. Observed top-1 similarities (all correct #1 rankings):
   - "why is contextus proactive instead of a search tool" → 0.6751
   - "how does the lancedb api work" → 0.5268
   - "eslint promise handling rules" (--type) → 0.5887
   - "lancedb api" → 0.4970

2. **Query-length / phrasing sensitivity.** The *same* correct doc scored 0.5268 for a full question but 0.4970 for the 2-word fragment "lancedb api" — asymmetric nomic rewards fuller, question-shaped queries (the `search_query:` prefix expects them). Real Claude prompts are sentences, so production queries trend higher than terse fragments — but the floor must tolerate the low end.

3. **Relative separation >> absolute score.** The gap between #1 and #2 is the real signal: 0.50 vs ~0.00, 0.68 vs 0.04. The winner is unambiguous regardless of the absolute number. A fixed absolute floor discards this; relative separation captures it.

**Decision/direction for Phase 5** (not hard-coded now — the harness sets the real number from a corpus of real prompts):
- **Prefer top-K + relative separation over a hard absolute threshold.** This is what DESIGN.md already hints (DESIGN.md ~:477: "Prefer top-K selection over hard thresholds … use threshold as a quality filter after ranking, not as a retrieval gate"). These findings are the empirical backing.
- Use any absolute floor only as a **weak quality filter** after ranking, not as the gate.
- Calibrate against **real historical prompts** (sentence-shaped), not terse test fragments, or the floor will be biased low.

**Caveat**: these numbers are provider-specific (ollama nomic). If the corpus is rebuilt with Transformers.js nomic or a mirror, re-measure — the distribution may shift (same model family, but quantization/runtime differ).

**Related**: [[embedding-download-risk]], [[ollama-model-quality]], [[design-scoping-v1-v2]]
