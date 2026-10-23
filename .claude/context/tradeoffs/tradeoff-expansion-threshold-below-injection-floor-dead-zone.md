---
name: expansion-threshold-below-injection-floor-dead-zone
description: >-
  Default expansionThreshold (0.55) sits below injectionFloor (0.70) — a score
  band where adaptive expansion never fires but injection still fails, so
  near-misses never get a rescue attempt
metadata:
  type: tradeoff
  tags:
    - expansion
    - retrieval
    - injection-floor
    - calibration
---

## The gap

Default config: `expansion.expansionThreshold = 0.55` (`lib/config.ts:342`), `retrieval.injectionFloor = 0.70`. Adaptive expansion only fires when `initialBest < expansionThreshold`. That leaves a 0.55–0.70 dead zone: a query scoring in that band is judged "good enough, don't bother expanding" by the adaptive heuristic, but it's still below the injection floor and gets silently dropped. Expansion — the mechanism built specifically to rescue weak matches via alternate phrasings — never even attempts a rescue in exactly the band where it could plausibly help most.

The existing docs' own example illustrates this without anyone flagging it: `implementation/implementation-query-expansion.md`'s logging section shows a sample skip event `{"initialBest": 0.68, "threshold": 0.55}` — 0.68 clears the expansion threshold but not the floor.

## Real-world instance

Surfaced via a cross-session report while investigating why `reference-avoid-em-dash-in-external-communications.md` (a user-scope preference file) failed to inject on "write this external support email" (0.65) and "make sure it doesn't sound ai-written" (0.66) — both below floor, neither triggering expansion (both above 0.55). A direct `/search` with closer phrasing scored the same file at 0.7174 (above floor), confirming a rescuing phrasing exists but the live pipeline never looked for one. (Initially this was misattributed to a bug IN expansion's execution — see `gotchas/gotcha-expansion-ruled-out-for-em-dash-retrieval-discrepancy.md` for why that's wrong; the real issue is expansion never ran at all, by design.)

## Proposed fix

Tie `expansionThreshold`'s default to `injectionFloor` rather than a fixed independent constant — e.g. default `expansionThreshold = injectionFloor` (or floor + margin) so adaptive mode attempts a rescue for any query that wouldn't otherwise clear the floor. Costs nothing for already-passing queries (nothing to gain from expansion there) and gives every near-miss a shot instead of only the worst scorers.

## Tracking

Filed as [GitHub issue #102](https://github.com/equiphealth/claude-contextus/issues/102).

