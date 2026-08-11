---
name: mine-transcripts
desc: Retrospective pattern extraction from Claude Code session transcripts — the recurring safety net for context that live capture missed
---

# Transcript Mining

Complementary to in-session (staging-mode) capture: in-session catches the current turn, transcript mining catches everything that slipped through across *past* sessions. See `docs/long-running-turn-capture.md` and `decisions/decision-transcript-mining-recurring.md` for the full design rationale.

## How it runs automatically

A SessionStart hook checks each project's watermark (`~/.contextus/transcript-state.json`) and fires a **background** scan if it's been more than 24h since the last one (or never scanned). This is fire-and-forget — a detached process, not something the session waits on. You'll see a one-line `systemMessage` when it fires: `contextus: mining N recent session(s)...`.

This skill is for **on-demand** runs — checking status, forcing a scan now, or scanning with different flags than the automatic trigger uses.

## Commands

```bash
# Incremental scan of the current project (same as the automatic trigger)
pnpm mine-transcripts

# Show what would be extracted without writing anything
pnpm mine-transcripts --dry-run

# Override the lookback window (ignores the watermark)
pnpm mine-transcripts --since 7d
pnpm mine-transcripts --since 2026-06-01

# Scan a specific project by path
pnpm mine-transcripts --project /path/to/project

# Scan every known project (all session-log directories under ~/.claude/projects/)
pnpm mine-transcripts --all

# List all known projects with their watermark status, no scanning
pnpm mine-transcripts --list

# Bound a single run (rarely needed — see "No cap by default" below)
pnpm mine-transcripts --max-sessions 5
```

## No cap by default

Earlier versions hardcoded a cap of 3 sessions per run regardless of backlog size — a project whose trigger hadn't fired in weeks would silently drop most of the pending sessions on every manual catch-up run, with no warning that anything was skipped (GH issue #39). There is no cap by default now: an incremental scan processes every session since the watermark.

If more than 20 sessions are pending, the CLI prints a heads-up (not a block) since extraction calls the LLM (Haiku via Ollama or Bedrock) once per conversation window — a large backlog means real time and real cost. Use `--max-sessions N` to deliberately bound a single run (e.g. a quick spot-check) if you want that.

## Dedup

Before writing, each extracted pattern is checked against the existing corpus via `/query` — if a similar pattern already scores above 0.82 similarity, it's skipped (`[dedup] Skipped: <slug>`). This is why a large backlog often extracts far fewer NEW patterns than the raw session count suggests: most of what live capture already caught doesn't get re-added.

## Output

Written patterns land the same way `/capture` always does — real files under `.claude/context/<category>/`, tagged `transcript-mined`, appearing in `git status` for review. Same trust model as live staging-mode capture: nothing is silently pushed, you review and commit what's useful.

## Watermark state

`~/.contextus/transcript-state.json`, keyed per project (slug = the project's absolute path with `/` and `.` replaced by `-`, matching Claude Code's own `~/.claude/projects/<slug>/` convention):

```json
{
  "version": 1,
  "projects": {
    "-Users-you-src-your-project": {
      "lastScanned": "2026-08-11T00:00:00.000Z",
      "lastSessionFile": "abc123.jsonl",
      "patternsExtracted": 12,
      "sessionsProcessed": 4
    }
  }
}
```

`pnpm mine-transcripts --list` shows this per project without scanning anything.

## Requirements

- Contextus daemon running (writes go through `/capture`, dedup checks go through `/query`)
- An LLM provider reachable for extraction (Ollama or Bedrock, per `providers` config) — this is read from the 3-tier MERGED project config, so a project's `.claude/contextus.jsonc` overrides (custom Ollama endpoint, Bedrock region) are honored the same way the daemon itself honors them

## Related

- `decisions/decision-transcript-mining-recurring.md` — why this runs on a schedule, not just at setup
- `docs/long-running-turn-capture.md` — the detection-completeness problem this backstops
- `/context-status` — shows overall corpus health, not transcript-mining-specific state
