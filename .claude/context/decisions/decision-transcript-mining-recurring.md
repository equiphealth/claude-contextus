---
name: transcript-mining-recurring
description: Transcript mining runs on a schedule (not just setup), tracking scan watermark to catch missed context — trigger implemented via SessionStart hook (GH issue #39); all known issues from the independent review of PR #40 now fixed
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

**Implemented** (PR #40): `/contextus-setup` now asks (Quick Track Q3, Power User P10) whether to run the one-time bootstrap scan, and calls `mine-transcripts.ts`'s `mineProject()` in-process via a new `--mine-transcripts` flag when the user says yes.

## Cost Model

- Each scan calls the extraction LLM (Haiku) once per session window — cost scales with how much history there is to catch up on, not a fixed per-scan number. A quiet week is cheap; a backlog of dozens of unscanned sessions (e.g. mining was off for a while, or a fresh bootstrap on a busy project) costs proportionally more.
- Not yet benchmarked against real usage — avoid quoting a specific dollar figure in user-facing copy (setup wizard, skill docs) until it is. `skills/contextus-setup/reference.md` was corrected to describe the *scaling* rather than an unverified "usually a few cents" estimate (independent review of PR #40, item #12).
- Frequency: daily or per-session-start is fine once caught up — transcripts are small once filtered to the delta.
- Compare to: $0 if no patterns were missed, but the insurance value is high.

## Resolved (GH issue #39 + independent review of PR #40 — all known issues now fixed)

The engine (this decision, PR #13) existed for weeks with no trigger ever wired up — the watermark could go stale indefinitely with zero signal. Fixed:

- **Trigger: SessionStart hook**, gated on a 24h cadence (`checkTranscriptMining`) rather than firing on every session start. Chosen over cron (no scheduler infra to add/maintain) and a daemon idle-timer (the daemon's own idle-shutdown story isn't settled — see `daemon-lifecycle-question` — tying a second feature to an undecided lifecycle would compound the uncertainty). Fire-and-forget: spawns `scripts/mine-transcripts.ts` as a real detached OS process (`fireTranscriptMining`), since mining has no daemon endpoint — it calls the LLM directly, unlike `/reconcile`'s server-side background task.
- **Aggressiveness: unchanged from the original extraction pipeline** (Haiku confidence filtering + 0.82 dedup threshold) — not re-tuned as part of this fix. Separately, the session CAP was removed: a prior version hardcoded `maxSessions: 3` regardless of backlog size, so a stale watermark meant most pending sessions were silently dropped on every catch-up run. No cap by default now (`scripts/mine-transcripts.ts`), with a heads-up (not a block) printed above 20 pending sessions given the real LLM cost/time per session.
- **Notification: silently write, matching the existing staging-mode trust model** — the SessionStart hook does emit one `systemMessage` line when it fires ("mining N recent session(s)...") for transparency, but extracted patterns themselves land as files via `/capture` same as always; no per-pattern notification. Consistent with `docs/CAPTURE_PHILOSOPHY.md`'s "user commits what's useful" model.
- **Watermark no longer advances past a run that hit an infra failure** — `writePattern` now distinguishes "daemon unreachable" (`infraFailure: true`, must not advance) from a dedup skip or content-level rejection (safe to advance past, retrying wouldn't help). `mineProject` stops scanning further files on the first infra failure per run, keeping watermark progress contiguous instead of leaving gaps.
- **`--max-sessions` capping now advances the watermark to the last actually-processed file's own mtime**, not to `Date.now()` — the uncapped remainder of a backlog is deferred to the next run, not silently dropped forever.
- **The SessionStart trigger's mining check moved outside the embedding model's `warmOk` gate** — `checkCorpus` (which carries the piggybacked `transcriptMining` config) is now fetched unconditionally, since mining depends on the extraction LLM (Bedrock/Ollama), an unrelated provider to the embedder.
- **The reported "mining N recent session(s)" count now matches the actual scan window** — a never-scanned project's pending count is capped to the same 24h lookback `mineProject`'s own `parseSince` falls back to, instead of counting every session file regardless of age.
- **Concurrent-run lock added** — `acquireMiningLock`/`releaseMiningLock` (`lib/transcript/state.ts`), a PID-file lock enforced solely by `mineProject`. Two Claude Code sessions opened against the same project within the mining window used to both spawn a full scan of the same backlog; now the second spawn detects the lock and exits immediately, doing no real work. Enforced only on the spawned-process side — the SessionStart hook needs no matching lock-check logic, since a no-op second spawn is sufficient to prevent the double-cost problem.

Also added: a manual `/mine-transcripts` skill (`/ctx mine`) for on-demand runs — checking backlog status or forcing a scan outside the 24h cadence.

All items raised in the independent review of PR #40 are now addressed. See PR #40's review comment for the original list with severity, kept for historical reference.
