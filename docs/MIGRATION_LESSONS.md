# Migration Lessons: Automation Repo → Contextus

Real-time friction log from migrating `~/src/my-equip-mobile/automation` from custom
hooks + `.claude/memory/` to contextus, driven from the contextus-repo session on
2026-06-15. This is the dogfood + docs/skills validation pass.

Legend: ❌ Blocker · ⚠️ Friction · ✅ Smooth · 💡 Discovery

---

## Phase 1 — Audit

✅ **Gotcha pre-flight all held.** Every gotcha the memories warned about checked out
against source: daemon on 37800 (`/health` → `modelLoaded:true, provider:ollama`),
floor 0.45, `contextus-setup` honors `--dir` (`scripts/contextus-setup.ts:39`),
`embed`/`query` resolve sources from `process.cwd()` (`embed-contexts.ts:43`), hooks
live in `settings.json` not a `hooks.json`.

✅ **Automation hooks audit — nothing to retire.** `settings.json` has only
`mcpServers` (wdio-mcp) + `plugins` (typescript-lsp); `settings.local.json` has only
`permissions`. **No `hooks` key in either.** GAP_ANALYSIS already said this ("None
found… skills are explicitly invoked, not hook-driven") and it's confirmed. So the
"retire the old injector / multi-injector hazard" judgment step from the plan is a
**no-op for this repo** — there is no competing injector. The old system was 100%
skill-driven (`/memory-reminder`, etc.), not hook-driven.

💡 **The "two injectors fight" risk doesn't apply here.** Both migration memories and
the plan flagged retiring the old hook-based injector as the critical judgment step.
For automation specifically that risk is absent — there was never a hook injector.
Worth noting in the guide: audit *first*, because the scary step may not exist.

❌ **`migrate-memory` is doubly blind to this repo (BLOCKER).** Two compounding bugs
in `scripts/migrate-memory.ts`, both in the I/O layer (the pure mapping in
`lib/capture/memory-migrate.ts` is fine):
  1. **Repo-scoped** (known): `MEMORY_DIR`/`CONTEXT_DIR` derive from the script's own
     `__dirname` (`migrate-memory.ts:36-39`), so it can only ever migrate contextus's
     own memory, never a target project.
  2. **Non-recursive glob** (NEW, not in any memory): the loader globs
     `path.join(MEMORY_DIR, '*.md')` (`migrate-memory.ts:49`) — flat, one level.

💡 **The nesting bug would have silently eaten 96% of the corpus.** Automation's
`.claude/memory/` is organized into topic subdirs (framework/, testing/, sdk/, …):
**2 files at top level, 54 nested.** A flat glob migrates 2 and skips 54 *without
error*. The dangerous part: `embed-contexts` globs `**/*.md` (recursive,
`sources.ts:81`), so the corpus side would happily embed whatever got migrated — you'd
get a green "✓ Embedded" on a corpus that's missing almost everything, with no signal
anything went wrong. This is worse than the repo-scoping bug because the repo-scoping
fails loud (migrates the wrong project) while this fails silent.

**Fix chosen:** patch `migrate-memory.ts` to (a) accept `--project <path>` and (b) use
a recursive glob. One change closes both bugs and is exactly the "`--project` flag is a
sensible follow-up" the guide already names. Copy-in workaround (a) from the guide is
rejected — it would *also* only catch 2 files until the glob is fixed.

💡 **`feedback` is a banned category — enforced now, not just during migration.** The
user vetoed `feedback` as a category ("it's a non-category"). Turns out
CATEGORIES_AND_TAGS.md §1/§3 *already* declares `feedback-` invalid ("method, not
meaning") — it was philosophy that never got enforced because legacy memory used it.
We removed it repo-wide: `KNOWN_CATEGORY_PREFIXES`, `types.ts` union, reranker
`TYPE_BOOSTS`, `TYPE_FOLDER`, lance-client doc, and the migrate test. The 24 automation
`feedback_*` files + contextus's own 4 are reclassified to **decision / gotcha /
reference** by what question they answer.

💡 **Scope the reclassifier to `feedback`, not "any method-category."** Tempting to
generalize to all four doc-named invalid categories (`feedback`/`idea`/`notes`/`misc`).
Decided against it. Migration is a niche one-time path (few projects will ever run it);
the durable concern is *new* categories created going forward. And those are **already
guarded**: the embed prefix↔type gate (`findPrefixTypeMismatches`) hard-aborts on any
prefix not in `KNOWN_CATEGORY_PREFIXES`. So `idea-`/`notes-`/`misc-` can never silently
enter a corpus — they fail loud at creation, forcing a human to recategorize (correct
treatment for a garbage bucket). `feedback` earned active reclassification *only*
because it was historically a valid prefix and would otherwise pass the gate. The
forward guard, not the migration converter, is where the principle lives.

💡 **Banning a prefix declassifies it, it does NOT reject existing files.** After
removing `feedback` from `KNOWN_CATEGORY_PREFIXES`, a re-embed of contextus's own
corpus still reported `by type: feedback=4` — from the **global** `~/.claude/memory`
(`userContext` source), which I'm not migrating. Why they pass: the embed gate
(`findPrefixTypeMismatches`) only checks files whose filename prefix *is* a known
category but disagrees with `metadata.type`. Once `feedback` isn't known,
`categoryPrefix('feedback_x.md')` returns null → the file is treated as
"uncategorized" → **exempt from the gate**, and its raw `type: feedback` frontmatter
flows straight through. So the ban stops *new* feedback files from being created with a
valid-looking prefix, but legacy feedback files already on disk are silently tolerated
as type `feedback` (now with no reranker boost — `TYPE_BOOSTS` has no entry, so they
fall to the default weight). The migration reclassifier is what actually scrubs them;
the gate alone won't. Worth knowing if anyone expects the ban to "clean" a corpus on
its own — it doesn't.

---

## Phase 2 — Migrate (dry-run)

✅ **Patched `migrate-memory --project` works end-to-end on real data.** Dry-run
against automation found all **56 files** (recursive glob confirmed — the old flat glob
would have found 2), resolved paths correctly under the automation root, and printed
the project root in the header so a misfire would be obvious. No copy-in, no manual
flattening.

✅ **Reclassifier behaves on real corpus.** 24 `feedback_*` files re-homed cleanly:
15→decision (conventions: use-logger-helper, locators-only, prefer-qa-environment…),
6→gotcha (pitfalls: ios-isdisplayed-quirk, browserstack-swipe-instability,
chainable-promise-types…), and the AI-process ones (proactive-*, check-claude-mem)
correctly →reference. Final plan: **15 decision / 6 gotcha / 3 project / 32 reference**,
zero `feedback`.

💡 **`tags=0` on every file is correct, not data loss.** Initially read as a bug — the
migrate report showed `tags=0` for all 56. Checked the source: **none of automation's
memories carry a `tags:` field at all.** The migration faithfully reports empty (and
notes "seed manually if useful"). It never fabricates tags — exactly the documented
contract. Lesson for the guide: a wall of `tags=0` is expected when the source corpus
predates tagging; it's a `/tag-context` backfill cue, not a migration failure.

💡 **Source frontmatter is inconsistent; the migration normalizes it.** Automation
memories mix schemas freely — `name: Use Logger Helper` (title-case) + top-level
`type:` in one file, `name: ios-isdisplayed-quirk` (kebab) + nested `metadata.type:` in
another. `planFile` handles both: kebabs the name into the slug, reads type from either
location. No manual cleanup needed pre-migration. Good robustness, worth stating in the
guide so people don't try to hand-normalize first.

⚠️→✅ **CONTEXT.md was hand-maintained and drifted — now `migrate-memory` regenerates
it.** When I recategorized the 4 own-corpus files, the index didn't follow (it listed 3
of 20 files — stale long before this). Root cause: `migrate-memory` wrote context files
but never touched the index, and nothing at embed-time reconciles them. CONTEXT.md is in
the embed exclude globs (`**/CONTEXT.md`) so drift never pollutes *retrieval* — but it's
the human-facing map. **Fixed:** added `renderContextIndex()` (pure, grouped-by-type,
unit-tested) and `migrate-memory --apply` now writes CONTEXT.md from the plan, MEMORY.md
style. Unknown types fall under "Other" so nothing is silently dropped.

---

## Phase 2 — Embed (the big one)

❌ **BLOCKER + DOC CORRECTION: `pnpm --prefix … run embed` embeds the WRONG project.**
Every memory and MIGRATION_GUIDE.md §2.4 "confirmed" this gotcha: *"embed/query resolve
sources from cwd — run from the project dir via `--prefix`."* **It is categorically
wrong.** Running `pnpm --prefix ~/src/claude-contextus run embed` from the automation
dir embedded **contextus's own corpus** (sources resolved to `claude-contextus/.claude/
context`, DB target `~/.contextus/data/claude-contextus`) — the 56 migrated automation
files were never embedded, and it printed a green `✓ Embedded`.

**Root cause (proven):** `pnpm --prefix <dir> run` sets `process.cwd()` to `<dir>`, not
the directory you invoked from. embed-contexts resolves sources relative to
`process.cwd()` (`sources.ts:71` `path.resolve`) and names the DB from
`path.basename(process.cwd())` (`config.ts:255`). So `--prefix` *moves* cwd to contextus
— defeating the exact cwd-relative resolution the advice depends on. Verified directly:
`pnpm --prefix ~/src/claude-contextus exec node -e "process.cwd()"` from automation
prints `…/claude-contextus`.

✅ **Correct invocation — keep the project as cwd, call contextus's tsx by path:**
```bash
cd ~/your-project
~/src/claude-contextus/node_modules/.bin/tsx ~/src/claude-contextus/scripts/embed-contexts.ts
```
This embedded the right thing: sources → `automation/.claude/context` + `automation/
docs`, DB → `~/.contextus/data/automation`, **105 files / 937 chunks**
(decision=78, gotcha=24, project=30, reference=345 — reclassification confirmed live,
zero project feedback). Same fix applies to `query` (`scripts/search.ts`).

✅ **Retrieval verified.** Query "how should I log messages in automation code" →
#1 hit `decisions/decision-use-logger-helper.md` @ 0.529 (the migrated feedback→decision
file). The migration + reclassification is end-to-end live.

⚠️ **Default floor is the un-calibrated 0.7 — everything reads "below floor."** `query`
gates on 0.7 (DESIGN default), but the automation corpus tops out at 0.529 for a
known-good match. This is precisely why automation needs its OWN floor (plan step 5;
≠ contextus's 0.45). At 0.45 the logger hit injects; at 0.7 nothing does. Calibration
isn't optional polish here — without it the corpus retrieves but never *injects*.

💡 **Migration stays deterministic; Haiku judgment goes in the skill, not the script.**
Considered making the whole conversion (recategorize + generate + write) a Haiku
subagent. Decided: keep the **mechanical** path deterministic — I/O, slug/frontmatter
normalization, and index generation are pure, unit-tested, offline/CI-safe, and uphold
verify-before-embed (you can't trust a corpus an LLM silently rewrote). The one place
Haiku genuinely beats code is **recategorization** — `reclassifyFeedback` is a regex
keyword heuristic (got 24/24 here, but brittle: a file with no pitfall keyword falls to
the `decision` default regardless of meaning). That semantic "what question does this
answer?" call is Haiku's lane (CLAUDE.md §5; the `/tag-context` lightweight-subagent
pattern). Plan: the extracted `/contextus-migrate` skill drives a Haiku classifier for
categorization + spot-checks and calls the script for the rote I/O. Best of both — the
script never grows an API dependency, the skill adds the judgment.
