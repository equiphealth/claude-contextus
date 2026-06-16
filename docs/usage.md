# Day-to-Day Usage

You've installed contextus and run `/contextus-setup` ([quick-start.md](quick-start.md)).
This is what to actually *do* with it: capture patterns, read injections, keep the
corpus healthy.

The mental model: **you curate a small corpus of project patterns; contextus retrieves
the relevant ones and injects them into Claude's context on every prompt.** You don't
search — the context finds you.

---

## Creating context

A "context file" is a markdown file under `.claude/context/`, organized into typed
subdirectories (`decisions/`, `gotchas/`, `patterns/`, …) with frontmatter. Each file
holds **one** pattern, decision, or gotcha.

| Want to… | Use |
|---|---|
| Capture a new pattern deliberately | `/create-context` — prompts for type, writes valid frontmatter, embeds it |
| Let Claude propose one mid-session | The awareness footer proposes `propose: <file>` blocks; you approve |
| Convert an old `.claude/memory/` system | `/migrate-memory` (see [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)) |
| Backfill tags on existing files | `/tag-context` — proposes topical tags, you approve |

**Why the frontmatter `type` matters:** it must match the directory (a file in
`decisions/` is `type: decision`, not `type: pattern`). A mismatch can't embed — it gets
quarantined and the file silently won't inject. `/create-context` pins the right schema
so you don't hit this by hand; if you do, `/context-doctor` diagnoses it.

**Write for retrieval.** A context file is matched semantically against your prompts, so
give it a descriptive first line and natural-language body — the way you'd actually ask
about it. Terse keyword-stuffed files retrieve *worse*, not better.

---

## Reading injections

When a prompt retrieves context above the floor, Claude sees a block tagged:

```
[contextus — relevant project context]
```

prepended to your message. When Claude uses one, the reply ends with a footer:

```
Context: used: decision-use-logger-helper.md (0.62)
```

**Trust that footer.** It's **daemon-generated and whitelisted** — the daemon tells
Claude the exact files + scores it injected, so the footer can't name a file that wasn't
actually retrieved. (Earlier it was reconstructed from memory and occasionally
hallucinated filenames; that's fixed.) If you ever see a footer naming a file the daemon
log didn't inject, that's a real bug → `/context-doctor` symptom C.

**When nothing is injected**, you'll see no tag and no footer. That's normal and
intended — not every prompt should receive context. The injection *floor* is the gate
(see [calibration.md](calibration.md)).

---

## Sources

Contextus retrieves from multiple "packs," configured in `plugin.json` under
`config.sources`:

| Source | Scope | Path | Holds |
|---|---|---|---|
| **Project context** | project | `.claude/context/` | Your curated patterns/decisions/gotchas |
| **Project docs** | project | `docs/` | Reference documentation |
| **User memory** | user | `~/.claude/memory/` | Cross-project preferences |
| **User docs** | user | `~/.claude/docs/` | Personal reference |

Project context is the primary, write-often source; the others are ambient. Each pack
can be toggled in `plugin.json`.

---

## Maintenance

| Task | Skill | When |
|---|---|---|
| Health/impact dashboard | `/context-status` | Anytime — corpus size, injection rate, latency |
| Something looks broken | `/context-doctor` | No injections, wrong corpus, phantom re-embeds |
| Find what a prompt retrieves | `/context-search "question"` | Debugging relevance; shows scores + floor |
| Find untagged files | `/audit-context` | Periodic corpus hygiene |
| Find stale/outdated files | `/audit-stale` | Periodic; flags drifted patterns |
| Force a full re-embed | `/rebuild-embeddings` | After bulk edits or if staleness looks wrong |
| Tune the injection floor | `/context-calibrate` | After ~a week of use ([calibration.md](calibration.md)) |

Most of the time you don't run any of these — the session-start hook reconciles a
cold/stale corpus in the background automatically. You only reach for these when tuning
or troubleshooting.

---

## Running engine scripts directly (advanced)

The skills wrap deterministic TypeScript engines. To run one by hand, use the
repo-local `tsx` **by path**, from the target project — **never `pnpm`**:

```bash
cd <target-project>   # cwd determines which corpus is touched
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/search.ts "your query"
```

Why not `pnpm`? The contextus repo requires Node 22; a shell on a different Node makes
`pnpm` error out. And `pnpm --prefix ~/src/claude-contextus` is doubly wrong — it sets
cwd to the contextus repo, so you embed/inspect the **wrong corpus**. tsx-by-path keeps
cwd at your project.

---

## Shell wrapper (v1 today)

While install is still `--plugin-dir` (pre-marketplace), typing it every session is
friction. A directory-aware `claude()` zsh wrapper can auto-add
`--plugin-dir ~/src/claude-contextus` **only** in projects that have contextus set up
(detected by the `.claude/context/` dir or the CLAUDE.md stanza), leaving teammates'
clean repos untouched. This is a personal stopgap until v1.1 makes multi-project install
first-class.

---

## Next

- **[calibration.md](calibration.md)** — tune the injection floor to your corpus and run
  the usage-eval refinement loop.
- **[quick-start.md](quick-start.md)** — the 5-minute setup, if you skipped here.
