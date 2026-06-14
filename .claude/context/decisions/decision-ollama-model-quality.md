---
name: ollama-model-quality
description: Ollama small models (8B) unreliable for semantic evaluation, but thinking blocks help
metadata:
  type: decision
---

**Context**: User's experience with Llama 3.1/3.2 8B in vector-inspector: "really bad" at semantic search quality evaluation. Models did keyword matching instead of semantic understanding — if exact term absent, produced strange results.

**Key distinction**: vector-inspector task (predict relevance pre-response) is **harder** than contextus task (judge usage post-response with thinking blocks as evidence).

**Decision**: Keep Haiku as default, position Ollama as privacy-focused opt-in requiring validation.

**Model quality tiers**:
- **Tier 1 (Frontier)**: Opus, Sonnet, GPT-4 — reliable semantic judgment ($1.50/100 evals)
- **Tier 2 (Mid-tier)**: **Haiku**, GPT-4o-mini — good structured tasks ($0.08-0.15/100 evals) ✅ Default
- **Tier 3 (Small local)**: Llama 3.1 8B, Mistral 7B — unreliable for semantic evaluation

**Why thinking blocks change the equation**: With `preceding_reasoning`, evaluation becomes "did Claude say they used this?" not "infer semantic relevance." This makes tier 3 models more viable than in vector-inspector (which had no ground truth).

**Hardware considerations** (for Ollama):
- M4 Pro 48GB: ~500ms-1s (8B), ~2-4s (70B-q4)
- RTX 3060 12GB: ~1-2.5s (8B), longer for 70B
- Entry-level: ~3-5s (too slow for comfortable use)

**Recommendation**: 
- Default: Haiku ($0.15, proven)
- Opt-in: Ollama with validation (compare first 20 evals against Haiku baseline)
- Larger models (70B-q4) may be better but unproven

**Team with M4 Pro 48GB across board**: Ollama becomes more compelling (privacy, zero cost, ~1s latency acceptable), but still validate quality first.

**Related**: [[evaluation-architecture]], [[multi-model-architecture]]
