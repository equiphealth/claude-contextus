---
name: transcript-mining-recurring
description: Transcript mining runs on a schedule (not just setup), tracking scan watermark to catch missed context
metadata:
  type: decision
  tags: [transcript-mining, scheduling, detection-completeness]
---

# Transcript Mining as Recurring Safety Net

## Decision

Transcript mining is NOT a one-shot setup task. It runs on a schedule, tracking a "last scanned" watermark so it processes only new sessions since the previous scan. This makes it the final catch-all for any context that staging mode missed during live sessions.

## Why

The detection completeness problem (see `docs/long-running-turn-capture.md`) means some patterns inevitably slip through during live sessions — Claude's attention is on implementation, not capture. Transcript mining as a recurring process means those missed patterns still get captured eventually, just with a delay.

## Design Implications

1. **State file** — needs a `lastScannedAt` timestamp (or per-project watermark) persisted somewhere (likely `~/.contextus/transcript-state.json`)
2. **Trigger options** — SessionStart (scan since last session), daily cron, or daemon idle-timer
3. **Incremental by default** — only process `.jsonl` files modified after the watermark
4. **Dedup against existing corpus** — don't re-extract patterns contextus already has (use novelty check / semantic similarity)
5. **Still writes to staging** — extracted patterns appear in `git status`, user commits what's useful. Same trust model as live capture.

## Relationship to Setup

Setup runs the *first* scan (bootstraps from ~1 week of history). After that, the recurring scan picks up where setup left off. Same extraction pipeline, different trigger and scope.

## Cost Model

- Each scan: ~$0.01-0.05 (Haiku on recent transcripts, incremental)
- Frequency: daily or per-session-start is fine — transcripts are small once filtered to the delta
- Compare to: $0 if no patterns were missed, but the insurance value is high

## Open Questions

- Best trigger: SessionStart hook vs cron vs daemon idle-timer?
- How aggressive should extraction be? (Liberal = more git noise, conservative = misses things)
- Should it notify the user when it finds something? Or silently write + let git status speak?
