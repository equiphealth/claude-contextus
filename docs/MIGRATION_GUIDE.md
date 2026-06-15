# Migration Guide: Existing Hooks + Memory → Contextus

Guide for migrating from a custom hooks + `.claude/memory/` system to contextus. Written for dogfooding contextus in your own projects after v1 ships.

---

## Overview

**What you're migrating from:**
- Custom hooks (memory-reminder footer, session awareness, etc.)
- `.claude/memory/` directory with project memories
- Possibly `.claude/docs/` with reference documentation

**What you're migrating to:**
- Contextus daemon + query hook (proactive context injection)
- `.claude/context/` directory (patterns chunked + embedded)
- Contextus hooks (awareness, watch, session-start, stop-eval if using calibration)

**Key difference:** Your current system is *reactive* (you write memories, Claude reads them when reminded). Contextus is *proactive* (patterns are retrieved and injected automatically based on semantic similarity).

---

## Pre-Migration Checklist

Before you start:

- [ ] **v1 is working** — Run `pnpm run embed` successfully in the contextus repo
- [ ] **Daemon runs** — `pnpm daemon` starts without errors, `/health` returns `modelLoaded: true`
- [ ] **Tests pass** — `pnpm test` is green
- [ ] **Choose a pilot project** — Start with one project, not all at once
- [ ] **Backup current setup** — `cp -r .claude/memory .claude/memory.backup` (optional but safe)

---

## Phase 1: Audit Your Current Setup

### 1.1 Inventory Your Hooks

Check your hook config in `settings.json` (user- and/or project-level — current
Claude Code puts hooks under a `"hooks"` key in settings, not a standalone file):

```bash
cat ~/.claude/settings.json | jq '.hooks'              # user-level
cat .claude/settings.json 2>/dev/null | jq '.hooks'    # project-level
cat .claude/settings.local.json 2>/dev/null | jq '.hooks'  # local overrides
```

**Identify what each hook does:**
- Memory-reminder footer → **Replaced by** contextus `awareness-hook.js`
- Session awareness → **Replaced by** contextus `session-start-hook.js`
- Stop evaluation → **Keep if using calibration**, remove otherwise
- Custom project-specific hooks → **Keep these**, contextus complements them

**Decision:** Which hooks will you **replace** vs **keep alongside** contextus?

### 1.2 Audit Your Memory Directory

```bash
find .claude/memory -name "*.md" | wc -l  # How many memories?
du -sh .claude/memory                      # How much content?
```

**Check memory types:**
```bash
grep -h "^type:" .claude/memory/*.md | sort | uniq -c
```

**Questions to answer:**
- Are memories still relevant? (Check dates, stale references)
- Which memories are **patterns to follow** (good for context) vs **historical records** (not useful for injection)?
- Are there large comprehensive docs that should stay in `docs/` instead of chunked into context?

### 1.3 Check Docs Directory

```bash
ls -la .claude/docs/    # Does this exist?
du -sh .claude/docs/    # How much content?
```

Contextus can ingest both `.claude/context/` (curated patterns) and `.claude/docs/` (comprehensive guides). Decide which memories belong where.

---

## Phase 2: Run the Migration

### 2.1 Load Contextus in Your Project

Contextus runs from its own repo — the hooks reference scripts via
`${CLAUDE_PLUGIN_ROOT}`, and the daemon launches the repo-local `tsx`, so the
**whole repo must be reachable**, not just `.claude-plugin/` (that dir only holds
the plugin manifest; the hooks live in `hooks/hooks.json` and the code in
`scripts/`, `daemon/`, `lib/`). Load it with `--plugin-dir` pointing at the repo:

```bash
cd ~/your-project
claude --plugin-dir ~/src/claude-contextus
```

Verify the plugin is valid:
```bash
cd ~/src/claude-contextus
claude plugin validate
# Should pass: manifest + hooks resolve
```

> **Why not symlink just `.claude-plugin/`?** The hooks resolve sibling paths
> (`hooks/`, `scripts/`, `node_modules/.bin/tsx`) relative to the plugin root. A
> bare `.claude-plugin` symlink leaves those unreachable and the daemon can't
> spawn (BUILD_LOG Phase 2 flagged exactly this — `$PLUGIN_ROOT` must resolve to
> the full repo).

### 2.2 Migrate Memories to Context

Run the migration script from the contextus repo, pointed at your project. **Dry-run
is the default** — there is no `--dry-run` flag; a bare run writes nothing, and
`--apply` is what touches disk:

```bash
cd ~/src/claude-contextus

# Dry run (DEFAULT — shows the plan, writes nothing)
pnpm migrate-memory

# Review the output, then apply
pnpm migrate-memory --apply

# Apply + repoint plugin.json sources (stop reading from memory/, read context/)
pnpm migrate-memory --apply --repoint
```

> ⚠ **Current limitation:** `migrate-memory.ts` resolves `.claude/memory/` and
> `.claude/context/` relative to the **contextus repo itself** (`__dirname`), not
> your project's cwd. As written it migrates *contextus's own* memory, not an
> arbitrary project's. To migrate **another** project today, either (a) copy that
> project's `.claude/memory/` into the contextus repo, run the migration, and copy
> `.claude/context/` back, or (b) use the personal `/contextus-migrate` skill (see
> "Automating the migration" below), which handles cross-project paths. A
> `--project <path>` flag for the script is a sensible follow-up.

**What it does:**
- Converts `.claude/memory/slug_file.md` → `.claude/context/type/type-slug.md`
- Infers `type` from filename prefix or frontmatter
- Preserves tags
- Normalizes frontmatter to nested `metadata` schema
- Forces filename head to match type (so prefix↔type gate passes)

**What to review:**
- Check `.claude/context/` structure (decisions/, feedback/, reference/, etc.)
- Spot-check a few files to ensure content is correct
- Note any files the migration skipped (it logs these)

### 2.3 Scaffold Context Directory (if starting fresh)

If you don't have existing memories to migrate:

```bash
# contextus-setup honors --dir, so you can target any project root
cd ~/src/claude-contextus
pnpm contextus-setup --dir ~/your-project
```

This creates:
- `.claude/context/` directory with starter structure
- `CONTEXT.md` index (like MEMORY.md)
- Contextus stanza in project `CLAUDE.md` (marked, idempotent)
- Runs initial embed

### 2.4 Embed the Corpus

`embed` resolves sources from `plugin.json` **relative to the current directory**, so
run it from the project root (or it'll embed contextus's own sources):

```bash
cd ~/your-project
pnpm --prefix ~/src/claude-contextus run embed
```

> `--prefix` runs the contextus `package.json` script while keeping *your project*
> as cwd, so `embed-contexts` scans your project's `.claude/context/` + `docs/`. (If
> that's awkward, the `/contextus-migrate` skill wraps it.)

**What to watch for:**
- Embedding provider (Ollama vs Transformers.js) — check `plugin.json`
- Model download time (first run only, if using Transformers.js)
- Chunk count (you'll see `Embedded X chunks (Y files)` + a `by source:` / `by type:` breakdown)
- Any prefix↔type mismatches (the build **aborts** on these — fix the filename prefix or `metadata.type` and re-run)

**Verify the corpus:**
```bash
# Check LanceDB created the table (parent dir, not the .lance dir — see lancedb-connect-parent-dir)
ls -la ~/.contextus/data/your-project/

# Spot-check a retrieval (prints all top-k with similarity scores; no --verbose needed)
cd ~/your-project
pnpm --prefix ~/src/claude-contextus run query "how do I handle X"
```

---

## Phase 3: Update Hooks

### 3.1 Disable Old Hooks (Coexistence Period)

> **Where your hooks actually live:** in current Claude Code, hooks are configured
> in **`settings.json`** (`~/.claude/settings.json` for user-level,
> `.claude/settings.json` or `.claude/settings.local.json` for project-level), under
> a top-level `"hooks"` key — *not* a standalone `hooks.json`. (Contextus ships its
> own `hooks/hooks.json` as a **plugin** manifest; that's a different mechanism —
> the plugin loader reads it, you don't hand-merge it.) Check what you have:
> ```bash
> cat ~/.claude/settings.json | jq '.hooks'        # user-level
> cat .claude/settings.json 2>/dev/null | jq '.hooks'  # project-level
> ```

Don't delete your old hook config yet — back it up and remove the contextus-replaced
entries from your `settings.json` `hooks` block:

```bash
cp ~/.claude/settings.json ~/.claude/settings.json.bak
```

Then edit out (or rename the event key to park it) the entries contextus replaces —
the memory-reminder footer, session-awareness, etc.

### 3.2 Enable Contextus Hooks

Contextus's hooks come from its **plugin manifest** at `hooks/hooks.json` (pointed to
by `plugin.json`'s `"hooks": "hooks/hooks.json"`). When you load the plugin with
`claude --plugin-dir ~/src/claude-contextus`, they're active automatically — you do
**not** copy them into your `settings.json`. Inspect them with:

```bash
cat ~/src/claude-contextus/hooks/hooks.json
```

They wire:
- `SessionStart` → `session-start-hook.js` (daemon warm + cold-corpus auto-reconcile)
- `UserPromptSubmit` → `query-hook.js` (injection) + `awareness-hook.js` (propose footer)
- `PostToolUse` (matcher `Write|Edit|MultiEdit|NotebookEdit`) → `watch-contexts.js`
- `Stop` → `stop-evaluation.js` (only does work during a calibration campaign)

### 3.3 Custom Hooks Coexist (No Merge Needed)

Because contextus's hooks come from the plugin and yours live in `settings.json`,
**they run side by side** — Claude Code fires both the plugin's hooks and your
settings hooks for the same event. You don't merge files; you just make sure your
remaining `settings.json` hooks don't duplicate what contextus now does (e.g. drop
your old memory-reminder footer so you don't get two footers).

The plugin's `hooks/hooks.json` uses the standard nested shape (matcher + hooks
array), for reference:
```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/query-hook.js\"", "timeout": 5000 }
        ]
      }
    ]
  }
}
```

---

## Phase 4: Test in a Live Session

### 4.1 Start a Fresh Session

```bash
cd ~/your-project
claude
```

**What to observe:**
- SessionStart hook runs (check for contextus systemMessage)
- Daemon spawns (or reuses existing)
- First prompt injects context (check thinking block for references)

### 4.2 Test Retrieval

Ask a question you know has a relevant pattern:

```
User: "How do I handle X?"
```

**Check:**
- Does thinking mention the injected context? ("From the system reminders, I have relevant context: ...")
- Does the response reference specific patterns by name?
- At the end: "Context: used <pattern-name>"

**If nothing injects:**
- Check daemon logs: `tail -f ~/.contextus/logs/daemon.log`
- Check similarity scores (from the project dir): `cd ~/your-project && pnpm --prefix ~/src/claude-contextus run query "your question"`
- Verify corpus isn't empty: `ls ~/.contextus/data/your-project/`

### 4.3 Test Awareness Footer

Edit a context file, then finish the session:

```
User: "thanks, that helped"
```

**Check the response footer:**
- `Context: used <pattern-name>` (if context was used)
- `Context: propose <topic>` (if you discussed something new)

**Test the propose flow:**
- If you see `propose:`, the awareness hook is working
- You can create the memory with `/create-memory` (if you have that skill)

### 4.4 Test Incremental Re-Embed

Edit a context file:

```bash
echo "\n## New Section\nSome content" >> .claude/context/decisions/decision-foo.md
```

Save and continue the session. The watch hook should detect the change and trigger a re-embed. Check:

```bash
grep "embedded" ~/.contextus/logs/daemon.log | tail -5
```

---

## Phase 5: Coexistence Period (1-2 weeks)

Run both systems in parallel for a while:

**Keep both:**
- Old `.claude/memory/` (read-only, for reference)
- New `.claude/context/` (active, being updated)

**Watch for:**
- Patterns the old system caught that contextus missed
- Injection quality (are the right patterns being retrieved?)
- False positives (irrelevant context injected)

**Tune as needed:**
- Adjust `injectionFloor` if too much/too little injects
- Run `/context-calibrate --floor` to re-tune based on usage
- Add missing patterns to `.claude/context/`

---

## Phase 6: Cleanup

Once confident contextus is working:

### 6.1 Archive Old Memories

```bash
mkdir -p .archive
mv .claude/memory.backup .archive/memory-$(date +%Y%m%d)
```

### 6.2 Remove Old Hooks

Once you're confident, drop the parked entries from `settings.json` for good and
remove the backup + any now-unused custom hook scripts:

```bash
rm ~/.claude/settings.json.bak
# Edit settings.json to delete the old memory-reminder/awareness entries
# Delete custom hook scripts that contextus replaced, if any
```

### 6.3 Update Documentation

Update your project's `CLAUDE.md` to reflect the new setup:
- Mention contextus is active
- Remove instructions about the old memory system
- Add `/context-status` for checking health

---

## Automating the Migration (`/contextus-migrate` skill)

The steps above are deliberately manual the first time so you see what each does.
But the migration has two repetitive, error-prone halves that are worth wrapping in
a **personal skill** once you've done it once:

1. **Hook hygiene (the `settings.json` half)** — audit your `settings.json` `hooks`
   block, identify which entries contextus replaces (memory-reminder footer,
   session-awareness), park/remove them, back up first, and confirm no lingering
   duplicate footer. This is the fiddly, easy-to-get-wrong part — it's editing a
   live config you depend on.
2. **Project conversion (the `.claude/` half)** — run `migrate-memory` (with the
   cross-project path handling the bare script lacks today), scaffold via
   `contextus-setup --dir`, embed from the project root, and spot-check retrieval.

A skill is the right home because both halves are **judgment + mechanical mixed**:
the hook edits need a human eye on "is this safe to remove," and the conversion is a
fixed sequence that's tedious to retype. The skill drives the judgment calls
(showing you each hook before removing it) and automates the rote commands.

> **Why a personal skill, not a built-in:** it edits *your* `settings.json` and
> assumes your project layout — that's user-specific, so it belongs in your personal
> skills, not shipped in contextus. (If a clean, general version emerges, it could
> graduate into the plugin later.)

When building it, lean on the lightweight-subagent pattern from `/tag-context`: the
"which of these hooks is contextus replacing?" classification is a small bounded task
that doesn't need the session model.

---

## Troubleshooting

### Daemon won't start

**Check:**
```bash
cd ~/src/claude-contextus && pnpm daemon
```

**Common issues:**
- Port **37800** already in use (another daemon running) — note the daemon
  *self-handles* this: a second instance sees `EADDRINUSE` and exits cleanly, so
  this is rarely fatal
- Ollama not running (`ollama serve`)
- Model not pulled (`ollama pull nomic-embed-text`)
- Transformers.js can't download model (firewall/proxy)

**Fix:**
- Kill stale daemon: `pkill -f "tsx daemon/server.ts"` (or `kill $(cat ~/.contextus/runtime/daemon.pid)`)
- Set the provider in `plugin.json` → `config.embedding.provider` (`ollama` or
  `transformers`). There is **no `CONTEXTUS_PROVIDER` env override** — provider is
  config-only. (Env overrides that *do* exist: `CONTEXTUS_VERBOSITY`,
  `CONTEXTUS_WARM_ATTEMPTS`, `CONTEXTUS_WARM_INTERVAL_MS`, `CONTEXTUS_TEST_MODE`.)

### Nothing injects

**Check corpus exists:**
```bash
ls ~/.contextus/data/your-project/
# Should see: contextus.lance/ and contextus.meta.json
```

**Check query returns results:**
```bash
cd ~/your-project
pnpm --prefix ~/src/claude-contextus run query "test query"
# Prints the top-k with similarity scores
```

**Check floor isn't too strict:**
```bash
grep injectionFloor ~/src/claude-contextus/plugin.json
# Calibrated value is ~0.45 (chunked corpus); a value near 0.7 would inject nothing
```

### Wrong patterns inject

**Check what's in the corpus** (`query` prints all top-k chunks with scores by
default — there's no `--verbose`; raise `--k` to see more):
```bash
cd ~/your-project
pnpm --prefix ~/src/claude-contextus run query "your prompt" --k 10
```

**Tune retrieval:**
- Lower floor → more injects (more permissive)
- Higher floor → fewer injects (more strict)
- Re-run calibration after corpus changes: `/context-calibrate --floor`

### Incremental re-embed not working

**Check watch hook is wired** (it's in the plugin manifest, not your settings.json):
```bash
grep watch-contexts ~/src/claude-contextus/hooks/hooks.json
```

**Check daemon is running:**
```bash
curl http://localhost:37800/health
```

**Manually trigger re-embed:**
```bash
curl -X POST http://localhost:37800/notify \
  -H "Content-Type: application/json" \
  -d '{"file":"/path/to/changed-file.md","project":"your-project","cwd":"/path/to/project"}'
```

---

## Rollback Plan

If contextus isn't working and you need to revert:

### Quick Rollback

```bash
# Restore your old hook config
cp ~/.claude/settings.json.bak ~/.claude/settings.json

# Stop loading the plugin — just don't pass --plugin-dir next session
# (nothing to delete; the contextus repo stays where it is)

# Restore memory backup (if you moved it)
mv .archive/memory-YYYYMMDD .claude/memory
```

Since contextus runs as a `--plugin-dir` plugin (not a copied-in directory),
"removing" it is simply launching `claude` without `--plugin-dir`. Optionally kill
the daemon: `kill $(cat ~/.contextus/runtime/daemon.pid)`.

### Partial Rollback

Keep contextus loaded but stop it injecting — the cleanest way is to set the
capture/injection off rather than hand-editing the plugin's hooks. Or, for a hard
stop, launch without `--plugin-dir` and keep your old `settings.json` footer hook.

---

## FAQ

**Q: Can I use both memory/ and context/ at the same time?**
A: Yes! The migration doesn't delete `.claude/memory/`. Contextus reads from `.claude/context/` by default, but you can configure multiple sources in `plugin.json`.

**Q: Should I migrate docs/ too?**
A: Yes, contextus can ingest `.claude/docs/` alongside `.claude/context/`. The chunking handles large docs automatically.

**Q: What if I have memories in other projects?**
A: Run the migration per-project. Each project gets its own corpus in `~/.contextus/data/<project-name>/`.

**Q: How do I know if it's working?**
A: Check the thinking block. Claude will explicitly reference injected patterns: "From the system reminders, I have context about X..."

**Q: Can I delete .claude/memory/ after migration?**
A: Keep it for a week or two during the coexistence period. Once confident, archive it (don't delete — it's your work history).

**Q: What about global ~/.claude/memory/?**
A: It's **already ingested** — `plugin.json` enables `userMemory` (`~/.claude/memory`)
and `userDocs` (`~/.claude/docs`) as sources, so a full `pnpm run embed` pulls them
into the project's corpus (down-ranked below curated project context via
`SOURCE_WEIGHTS`). There's no *separate* cross-project global corpus yet (each
project's DB is isolated under `~/.contextus/data/<project>/`); a first-class global
layer is a v2 idea. So today: global memories show up in every project's corpus, but
each project embeds its own copy.

---

## Next Steps After Migration

Once migrated and stable:

1. **Run calibration** — `/context-calibrate --floor` to tune the injection floor from real usage
2. **Tag your context** — `/tag-context` to add semantic tags (makes CAE in v2 more effective)
3. **Monitor quality** — Start a calibration campaign (`/context-calibrate --start`) to measure usage
4. **Add more patterns** — Grow `.claude/context/` as you discover new patterns
5. **Share learnings** — If you find gaps or issues, they're v2 features

---

## Related Docs

- [V2_ROADMAP.md](V2_ROADMAP.md) — What's coming after v1
- [DESIGN.md](DESIGN.md) — How contextus works under the hood
- [BUILD_LOG.md](BUILD_LOG.md) — What was actually built in v1
