---
name: expansion-observability
description: Planned nice-to-haves for multi-vector expansion — fire rate metric in /context-status and log when expansion is skipped
metadata:
  type: project
  tags: [expansion, observability, status, logging]
---

**Planned enhancements for query expansion:**

1. **`/context-status` fire rate metric**: Show percentage of queries that triggered adaptive expansion (queries where initialBest < expansionThreshold). Helps tune the threshold.

2. **Log when expansion is skipped**: Currently only logs "Expansion fired". Should also log when expansion was considered but skipped (mode=adaptive, score above threshold) — useful for debugging "why didn't expansion help here?"

**Priority**: Nice-to-have, implement when touching `/context-status` or the expansion path.
