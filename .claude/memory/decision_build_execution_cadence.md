---
name: build-execution-cadence
description: How to run the v1 build — phase-then-return cadence, where to stop vs batch
metadata:
  type: decision
---

**Decision**: Run the v1 build as **phase-then-return**, stopping where verification needs a human or a live environment, batching where the exit criterion is deterministic and self-verifiable.

**Cadence** (6 prompts, 4 genuine decision points):

| Prompt | Phases | Stop reason |
|---|---|---|
| 1 | 0 | Highest-risk unknown — does `@lancedb/lancedb` match DESIGN.md's API assumptions? |
| 2 | 1 | Corpus now exists — verify authored context files are *true* before they harden into the injected corpus ([[selfdoc-build-practice]] §4.5) |
| 3 | 2 | The spine/demo — user drives a live Claude Code session to confirm real injection. Claude cannot self-verify. |
| 4 | 3 + 4 | Capture + pure-logic unit tests — green suite self-verifies, safe to batch |
| 5 | 5 | Calibration floor recommendation — needs user's historical prompts + eyes |
| 6 | 6 | Hardening → done |

**Batching rules**:
- 0→1 batch *only if* Phase 0's LanceDB API check passes; if it diverges, stop and re-plan before embedding.
- 3+4 always batch (tests are the verification).
- **Never batch across Phase 2** — building on a subtly-broken daemon spine cross-contaminates debugging and burns tokens.

**Why**: The real cost is the build-loop (daemon spawn/detach/poll) and per-turn context replay, not output verbosity. Returning at seams lets the user `/clear`/compact between prompts. Tighter boundaries also guard against Claude's optimistic "done!" narration on unrun code.

**At each stop**: state the exit criterion, what was verified vs. what needs the user to verify, and any DESIGN.md divergence.

Full version: `docs/IMPLEMENTATION_ESTIMATE.md` → "How to Run the Build (Execution Cadence)".

**Related**: [[design-scoping-v1-v2]], [[selfdoc-build-practice]]
