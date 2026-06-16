# Deferred Work — "what was I supposed to do eventually?"

**The single answer to that question.** Everything deliberately put off lives here, with
a status and what it's **blocked on**. When you have access/time, read the "Blocked on"
column and pick what's unblocked.

> Scope: near-term chores + decisions awaiting action. The bigger v2 feature vision
> lives in [V2_ROADMAP.md](V2_ROADMAP.md) (linked, not duplicated). Open *questions*
> (undecided forks) live as `question-` files in `.claude/context/questions/`.

_Last updated: 2026-06-15._

---

## 🔴 Blocked on external access (do when you have it)

| Item | Blocked on | Notes |
|---|---|---|
| **Smoke-test the marketplace install** | GitHub push + a clean machine/VM | The ONE unverified packaging path. Recipe in [PACKAGING.md](PACKAGING.md#smoke-test-recipe). Kill the daemon first or it tests nothing. |
| **Push commits to GitHub** | Your call on timing | ~10 packaging/docs commits sit local on `main`. Nothing pushed yet. |

## 🟡 Ready now (no blocker, just not done)

| Item | Where | Effort |
|---|---|---|
| **README toolchain caveat** | [PACKAGING.md](PACKAGING.md) unchecked box | Node 22 + build toolchain for native `@lancedb`; HF-blocked model-fetch note. (Partly done — README now has a Requirements section; confirm it's sufficient.) |
| **`/contextus-stop` command** | [DAEMON_LIFECYCLE.md](DAEMON_LIFECYCLE.md) | Cheap. The daemon has no off switch today (must kill the PID by hand). |
| **Daemon idle auto-shutdown** | `daemon/server.ts` | ~15 lines; respawn machinery already exists. See the open question below. |
| **Watch the `docs/` dir for changes** ⚠️ | `question-source-embed-scope` (corpus) | **User's top-concern miss (2026-06-15).** Doc edits don't re-embed → retrieval serves stale `projectDocs` silently until a full `pnpm embed`. Extend the watch hook / reconcile beyond `.claude/context/`. |
| **`contextus watch` running log** | [WEB_CONSOLE_EXPLORATION.md](WEB_CONSOLE_EXPLORATION.md) Option 6 | User's preferred observability direction. Audit LOGGING.md first. |
| **`/contextus-reembed --provider`** | `gotcha-embedding-provider-switch` (corpus) | Switching provider/model is a manual re-embed + restart today, nothing automates it. One command: config-write + `--rebuild` + daemon restart. `/context-doctor` should also flag corpus-vs-daemon model mismatch. |

## 🟢 Open questions (decide before building)

These are real forks, captured as `question-` context files so they resurface when you
work the area:

| Question | File | Leaning |
|---|---|---|
| Should the daemon run constantly? | `.claude/context/questions/question-daemon-lifecycle.md` | idle-timeout backstop + session-awareness + `/contextus-stop` |
| Read-only sources: per-source granularity + cache | `.claude/context/questions/question-source-embed-scope.md` | content-hash cache so a single-source update / provider switch doesn't force a full-table rebuild. (The docs-watching half is a ready-now fix above, not an open question.) |
| Version-pinning UX for installs | [tagged-releases memory] | `marketplace.json` version per release vs `@<tag>`/`@<sha>`; confirm vs Claude Code docs |
| Transformers-with-loaded-model as a first-class mode | [DAEMON_LIFECYCLE.md](DAEMON_LIFECYCLE.md) | already half-true (in-process pipeline stays warm); needs blessing + RAM-cost docs |
| Install-time convert of Claude-native memory → corpus | [idea-install-convert-native-memory memory] | Adoption hook: new user starts with a populated corpus. Scope-PRESERVING by default (project→project, user→user) + triage to promote only cross-project items. Reuse `/migrate-memory`, don't rebuild. |

## 🔵 v2 feature roadmap (the big stuff)

Tracked in full in **[V2_ROADMAP.md](V2_ROADMAP.md)** — not duplicated here. Highlights:
query transformation (dilution fix), token-cost report, CAE (LLM applicability gate),
hybrid semantic+keyword search, claude-mem→context promotion.

## ⚙️ release.yml follow-ups

`release.yml` was cleaned (Node 22, `.js`-only artifacts, npm-publish deleted — see
`decision-npm-not-used`). Remaining: decide the version-pinning UX (above) before
relying on tagged releases for install.

---

## How this index stays current

When you defer something, add a row here. When you finish it, delete the row (git
history keeps the record). The goal is that this file always answers "what's left?" in
one read — if it drifts out of date, it's worse than useless.
