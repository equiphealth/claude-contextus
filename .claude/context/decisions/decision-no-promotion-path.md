---
name: no-promotion-path
description: Why contextus feedback loop drives curation (archive/rewrite/merge) not promotion (copy to CLAUDE.md)
metadata:
  type: decision
  tags: ["phase2", "curation", "feedback-loop"]
---

# No Promotion Path — Curation Over Copying

**Decision:** The usage feedback loop drives **curation** (archive noisy patterns, rewrite for clarity, merge duplicates), NOT **promotion** (copying high-value patterns to CLAUDE.md or .claude/memory/).

## Rationale

Original Phase 2 design included promotion workflow: patterns with high weighted scores (≥ 0.7) would be copied to CLAUDE.md (always-loaded) or .claude/memory/ (session-loaded) to give them higher precedence.

**Why this is wrong:**

1. **Retrieval already works** — Patterns with high scores naturally rank higher in future retrievals. The feedback loop proves the system is working, not that promotion is needed.

2. **System prompt bloat** — Copying patterns to CLAUDE.md causes unbounded growth. A corpus with 50 high-value patterns would add 50 sections to CLAUDE.md, most irrelevant to any given prompt.

3. **Removes semantic gating** — Promoted patterns always load, even when irrelevant. This defeats the purpose of retrieval — delivering the right context at the right time.

4. **Duplicates work** — Pattern appears twice: once in CLAUDE.md (always) and again via retrieval (when relevant). The CLAUDE.md copy is redundant noise most of the time.

5. **Misses the point** — High-value patterns don't need help. They're already being delivered when relevant. The feedback loop should fix **problems** (noise, staleness, duplication), not celebrate success by copying it.

## What Feedback Should Drive

| Pattern Type | Score | Retrieval | Action |
|--------------|-------|-----------|--------|
| **Noisy** | < 0.3 | High (10+) | Archive or rewrite (false positive) |
| **Stale** | N/A | Zero in 6mo | Review: obsolete (archive) or undiscoverable (improve keywords) |
| **Duplicate** | N/A | Similar content | Merge into one pattern |
| **High-value** | ≥ 0.7 | High | **Keep as-is** — it's working |
| **Niche** | Mixed | Low | Keep (low volume is expected for specialized patterns) |

## User Insight (2026-06-26)

> "I'm thinking it doesn't need to be promoted at all if it's already proving useful it will be injected. Perhaps it's just not as quickly determined stale? No reason to add to CLAUDE.md either"

This crystallized the flaw in the promotion design. High-value patterns prove themselves by scoring well — they don't need elevation. The feedback loop's job is **noise reduction and quality improvement**, not **promotion**.

## Implementation Impact

Removed from Phase 2/3:
- `/context-promote` skill (deleted)
- `/ctx-promote` alias (deleted)
- Promotion workflow in `/context-review` (reframed as archive/rewrite/merge)
- CLAUDE.md copy logic (never implemented)
- .claude/memory/ promotion (never implemented)

Updated design doc (`docs/dev/USAGE_FEEDBACK_LOOP.md`) to reflect curation-focused approach.

## Related

- **Phase 2 implementation** — `/context-stats`, `/context-review`, `/context-doctor` (all reframed for curation)
- **Phase 3 primitives** — `/context-archive`, `/context-merge` (correct primitives for noise reduction)
- **Staleness detection** — Not a promotion trigger, a review trigger (obsolete vs niche)

