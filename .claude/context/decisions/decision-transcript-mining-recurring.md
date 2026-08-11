---
name: transcript-mining-recurring
description: Transcript mining runs on a schedule (not just setup), tracking scan watermark to catch missed context — trigger implemented via SessionStart hook (GH issue #39)
metadata:
  type: decision
  tags: ["transcript-mining", "scheduling", "detection-completeness", "fixed"]
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

**Not yet implemented**: `/contextus-setup`/`scripts/contextus-setup.ts` does not call `mine-transcripts` at all — this section describes intent, not current behavior. The SessionStart trigger (below) covers ongoing recurrence; the setup-time bootstrap scan is still a real gap, tracked as remaining scope on GH issue #39.

## Cost Model

- Each scan: ~$0.01-0.05 (Haiku on recent transcripts, incremental)
- Frequency: daily or per-session-start is fine — transcripts are small once filtered to the delta
- Compare to: $0 if no patterns were missed, but the insurance value is high

## Resolved (GH issue #39, implemented in `scripts/lib/daemon-control.js` + `scripts/session-start-hook.js`)

The engine (this decision, PR #13) existed for weeks with no trigger ever wired up — the watermark could go stale indefinitely with zero signal. Fixed:

- **Trigger: SessionStart hook**, gated on a 24h cadence (`checkTranscriptMining`) rather than firing on every session start. Chosen over cron (no scheduler infra to add/maintain) and a daemon idle-timer (the daemon's own idle-shutdown story isn't settled — see `daemon-lifecycle-question` — tying a second feature to an undecided lifecycle would compound the uncertainty). Fire-and-forget: spawns `scripts/mine-transcripts.ts` as a real detached OS process (`fireTranscriptMining`), since mining has no daemon endpoint — it calls the LLM directly, unlike `/reconcile`'s server-side background task.
- **Aggressiveness: unchanged from the original extraction pipeline** (Haiku confidence filtering + 0.82 dedup threshold) — not re-tuned as part of this fix. Separately, the session CAP was removed: a prior version hardcoded `maxSessions: 3` regardless of backlog size, so a stale watermark meant most pending sessions were silently dropped on every catch-up run. No cap by default now (`scripts/mine-transcripts.ts`), with a heads-up (not a block) printed above 20 pending sessions given the real LLM cost/time per session.
- **Notification: silently write, matching the existing staging-mode trust model** — the SessionStart hook does emit one `systemMessage` line when it fires ("mining N recent session(s)...") for transparency, but extracted patterns themselves land as files via `/capture` same as always; no per-pattern notification. Consistent with `docs/CAPTURE_PHILOSOPHY.md`'s "user commits what's useful" model.

Also added: a manual `/mine-transcripts` skill (`/ctx mine`) for on-demand runs — checking backlog status or forcing a scan outside the 24h cadence.

