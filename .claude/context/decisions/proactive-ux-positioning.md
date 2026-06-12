---
name: proactive-ux-as-killer-feature
description: Position automatic context injection as primary differentiator, not search quality
type: decision
category: product
---

# Proactive UX as Killer Feature

**Decision**: Frame contextus as "proactive ambient context system" not "better semantic search tool."

## Rationale

External feedback (June 12, 2026) identified that design docs were burying the transformative UX under retrieval mechanics.

**The killer feature isn't "better search" — it's no search at all.**

## What Changed

### README + DESIGN.md

- Added "Vision: Proactive Context, Not Search" section
- Updated comparison table: "Retrieval Mode" row (automatic vs manual)
- Emphasized zero cognitive load, automatic capture, self-improving quality

### Messaging Hierarchy

1. **User value**: Zero cognitive load, automatic proposals, self-tuning
2. **Technical implementation**: Daemon, compression, re-ranking as means to UX goal

## vs. claude-mem

**Positioning**: "Do You Need Another Memory System? Short answer: probably not."

contextus is automatic/proactive, claude-mem is manual/reactive. Most users only need contextus. claude-mem is optional power-user add-on for temporal recall.

## How to Apply

When explaining contextus:
- Lead with "context just appears when you need it"
- Position calibration as self-tuning, not manual config
- Emphasize hit tracking = learning what matters
- Technical details (embeddings, Chroma) are implementation, not selling point
