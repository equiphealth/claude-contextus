---
name: transcript-mining-recurring
description: Transcript mining runs on a schedule (not just setup), tracking scan watermark to catch missed context — trigger implemented via SessionStart hook (GH issue #39); known issues found in independent review of PR #40 not yet all fixed
metadata:
  type: decision
  tags: ["transcript-mining", "scheduling", "detection-completeness", "fixed", "known-issues"]
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

**Implemented** (PR #40): `/contextus-setup` now asks (Quick Track Q3, Power User P10) whether to run the one-time bootstrap scan, and calls `mine-transcripts.ts`'s `mineProject()` in-process via a new `--mine-transcripts` flag when the user says yes.

## Cost Model

- Each scan: ~$0.01-0.05 (Haiku on recent transcripts, incremental)
- Frequency: daily or per-session-start is fine — transcripts are small once filtered to the delta
- Compare to: $0 if no patterns were missed, but the insurance value is high

**Caveat (independent review of PR #40, unverified dollar figure):** the setup bootstrap path runs `since: '7d'` with no session cap, synchronously inside the wizard — for a daily Claude Code user that could be dozens of sessions/hundreds of extraction windows, which may not match this "few cents" estimate. Not yet re-measured against real usage.

## Resolved (GH issue #39, implemented in `scripts/lib/daemon-control.js` + `scripts/session-start-hook.js`)

The engine (this decision, PR #13) existed for weeks with no trigger ever wired up — the watermark could go stale indefinitely with zero signal. Fixed:

- **Trigger: SessionStart hook**, gated on a 24h cadence (`checkTranscriptMining`) rather than firing on every session start. Chosen over cron (no scheduler infra to add/maintain) and a daemon idle-timer (the daemon's own idle-shutdown story isn't settled — see `daemon-lifecycle-question` — tying a second feature to an undecided lifecycle would compound the uncertainty). Fire-and-forget: spawns `scripts/mine-transcripts.ts` as a real detached OS process (`fireTranscriptMining`), since mining has no daemon endpoint — it calls the LLM directly, unlike `/reconcile`'s server-side background task.
- **Aggressiveness: unchanged from the original extraction pipeline** (Haiku confidence filtering + 0.82 dedup threshold) — not re-tuned as part of this fix. Separately, the session CAP was removed: a prior version hardcoded `maxSessions: 3` regardless of backlog size, so a stale watermark meant most pending sessions were silently dropped on every catch-up run. No cap by default now (`scripts/mine-transcripts.ts`), with a heads-up (not a block) printed above 20 pending sessions given the real LLM cost/time per session.
- **Notification: silently write, matching the existing staging-mode trust model** — the SessionStart hook does emit one `systemMessage` line when it fires ("mining N recent session(s)...") for transparency, but extracted patterns themselves land as files via `/capture` same as always; no per-pattern notification. Consistent with `docs/CAPTURE_PHILOSOPHY.md`'s "user commits what's useful" model.

Also added: a manual `/mine-transcripts` skill (`/ctx mine`) for on-demand runs — checking backlog status or forcing a scan outside the 24h cadence.

## Known Issues (found in independent review of PR #40, not yet all fixed as of this writing)

See PR #40's review comment for the full list with severity. Highlights, since they undercut claims made above:

- **The watermark advances even when every extraction/capture call in a run failed** (`mine-transcripts.ts`) — if the daemon is down when the SessionStart trigger fires, the affected sessions are marked scanned anyway and permanently skipped on future runs. This is the exact silent-staleness failure mode this decision exists to prevent, reintroduced one layer down.
- **`--max-sessions` capping has the same permanent-skip problem** — capping at N sessions over a larger backlog advances the watermark to "now," not to the last processed file's timestamp, so the uncapped remainder is lost forever, not just deferred.
- **The SessionStart trigger is gated behind the embedding model's warmth (`warmOk`), not the extraction LLM's** — mining can fail to ever fire if the embedder is cold even when the extraction provider (e.g. Bedrock) is healthy.
- **The reported "mining N recent session(s)" count doesn't match what actually gets scanned** on a never-scanned project (counts ALL sessions, but the scan itself defaults to a 24h window).
- **No lock against two concurrent Claude Code sessions in the same project both firing a scan** — the watermark isn't updated until the spawned process finishes, so both can start full uncapped scans of the same backlog.

Do not treat the "Resolved" section above as fully settled until these are addressed — the trigger MECHANISM is real and wired up, but its failure-mode handling has real gaps.

