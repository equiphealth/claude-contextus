---
name: mine-transcripts
description: Mine past Claude Code session transcripts for patterns that were never captured live — the retrospective safety net
---

# mine-transcripts

**Extract missed context** from session history — decisions, gotchas, conventions that slipped through live capture.

## When to use

- User says "mine transcripts", "scan past sessions", "catch up on missed context"
- Checking how much backlog has piled up since the last automatic scan (SessionStart fires this in the background on a ~24h cadence — see `decision-transcript-mining-recurring.md`)
- After a long gap with the daemon down/unconfigured, where live staging-mode capture couldn't run

## When NOT to use

- For the CURRENT session's own work — that's live staging-mode capture (`/capture` via the daemon), not this
- If you just want a status check with no LLM cost — use `pnpm mine-transcripts --list` (see reference) or check `~/.contextus/transcript-state.json` directly for the last-scanned watermark

## Instructions

Execute silently. Run the incremental scan for the current project by default; report what was found (or that nothing new was found).

See [./reference.md](./reference.md) for:
- Full CLI flags (`--dry-run`, `--since`, `--all`, `--max-sessions`, `--list`)
- No session cap by default — a stale watermark can mean a real backlog; don't silently drop most of it
- How dedup against the existing corpus works
- Cost/time expectations for a large backlog
