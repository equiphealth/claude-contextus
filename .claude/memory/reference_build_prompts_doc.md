---
name: build-prompts-doc
description: Paste-ready kickoff prompts for the v1 build live in docs/BUILD_PROMPTS.md
metadata:
  type: reference
---

**`docs/BUILD_PROMPTS.md`** holds six copy-paste prompts, one per `/clear` cycle, to drive the claude-contextus v1 build. Each maps to a phase in `docs/IMPLEMENTATION_ESTIMATE.md` and stops at a verification seam.

Workflow: `/clear` → paste next prompt → run to stop → verify → commit → repeat. Decision points (need human/live verification): Prompts 1, 2, 3, 5. Prompts 0→1 only batch if the LanceDB API check passes; 3+4 batch; never batch across Phase 2.

**Related**: [[build-execution-cadence]], [[design-scoping-v1-v2]]
