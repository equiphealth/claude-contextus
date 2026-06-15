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

❌→✅ **The `query`/`search.ts` CLI reported the WRONG floor — injectable hits looked
dead.** Initial read: "top hit 0.529, everything below the 0.7 floor → nothing injects,
needs calibration." **Wrong on two counts.** (1) `search.ts` reported
`cfg.retrieval.similarityThreshold` (0.7) — but that's a post-rank *ranking* filter, NOT
the injection gate. (2) The real gate is `cfg.retrieval.injectionFloor` (**0.45**),
applied by the daemon's `/query` → `applyFloor` (`daemon/server.ts:192`) — which is what
`query-hook.js` actually calls. Worse, the CLI **hardcoded the string "0.7"** in its
flag label, so it'd lie even if the config changed.

**Impact:** at the true 0.45 floor, the migrated `decision-use-logger-helper` (0.529)
**injects**, and so does the docs hit at 0.474. The migration works *as-is*. Had I
handed off a live-verification session trusting the CLI, you'd have queried, seen
"⚠ below 0.7 floor" on every row, and concluded the migration failed. **Fixed
`search.ts`** to report `injectionFloor`, flag each row `✓ injects` / `won't inject`,
and stop hardcoding the number. Lesson: a spot-check tool that reports a *different*
threshold than the production path is worse than no tool — it manufactures false
negatives. Verify the CLI reads the same knob the hook does.

📝 **Floor calibration is still worth running, but it's tuning, not rescue.** The
corpus injects at the inherited 0.45. Automation's distribution differs from
contextus's, so `/context-calibrate --floor` will refine it (plan step 5) — but the
system is live and injecting *now*, not blocked on calibration.

---

## Phase 3 — Retire the old injector (the judgment step)

💡 **The "old injector" was USER-level, not project-level — and not where I first
looked.** Initial Phase-1 audit checked the *project's* `settings.json` (none) and the
GAP_ANALYSIS said "no hooks." Both true — but the real injector lives in
`~/.claude/settings.json` (user-level `UserPromptSubmit`), so it fires in *every*
project including this contextus session. **Lesson for the guide: audit user-level
settings.json explicitly, not just project-level.** A project with "no hooks" can still
be getting injected by a global hook.

💡 **The injector blob conflated THREE concerns; only one was contextus's to replace.**
The single `echo '{…}'` hook mixed: (a) a `Memory: used/propose/update` footer
instruction (← contextus's awareness-hook replaces this), (b) claude-mem search guidance
(`/mem-search`, ticket-number patterns — NOT contextus's job), and (c) a live A/B
experiment with an explicit `expires 2026-06-17` (`[mem-value:…]`). A blunt "remove the
hook" would have (b) lost unrelated guidance and (c) **killed a running experiment two
days early.** The correct edit was a *surgical extraction* of only (a). This is why hook
hygiene **must be LLM-driven, not scripted** — separating three welded concerns in one
opaque JSON string needs judgment about what each sentence *does*; no regex is safe
here. The mechanical halves (migrate, embed, index) are deterministic; this half is a
guided conversation. Done with: backup first (`settings.json.bak-pre-contextus-*`),
build a candidate, `diff` it, show the human each concern, ask, then promote.

💡 **The migration is a back-and-forth, not a command (user, 2026-06-15).** Every
genuinely tricky decision this run required *this user's specific* context: which
category to ban, how to scope the reclassifier, whether to share the LanceDB, and above
all which parts of a personal hook to keep. The `/contextus-migrate` skill should NOT
try to auto-apply settings.json edits — it should drive the dialogue: detect, propose,
diff, ask, back up, then write. The deterministic script is the skill's tool, not its
replacement.

🔭 **Follow-up A — claude-mem hook *hygiene* detection in `/contextus-migrate`.** The
surgical footer-split done by hand here recurs for anyone running claude-mem +
contextus. The skill could pattern-match a `UserPromptSubmit` hook carrying a
`Memory: used/propose/update`-style footer, distinguish it from co-located search
guidance + experiments, and *offer* the trim — backup, diff, confirm, never silent
auto-edit. (This is the migration-time concern; Follow-up B below is the runtime one.)

### Phase 4 — Live session (in progress, user-driven)

✅ **Daemon reuse + background auto-reconcile both fired (session-start, 2026-06-15).**
Live messages: *"using the running daemon (uptime 1h)"* (reuse ✓) and *"corpus is behind
your context files — re-embedding 1 in the background"* (Phase-6 auto-reconcile ✓ —
automation meta `createdAt` updated to session-start time). Validates the
`automation-migration-plan` claim that session-start picks up context even if you skip
the manual embed.

✅✅ **KEYSTONE VALIDATED — injection appears in the thinking block, by name + full
structure (2026-06-15).** Asked "how should I log messages in automation code?" in the
live automation session. Verbatim thinking: *"From the system-reminder, I can see: 1.
There's a contextus pattern about using the Logger Helper
(decisions/decision-use-logger-helper.md). 2. The rule is: Never use console.log… 3. The
why:… 4. How to apply:…"* — i.e. it named the pattern **by file path**, pulled the rule
/why/how-to-apply intact, and grounded the answer in it. This is CLAUDE.md's #1 "Design
Validation Needed" (*does user-message prepend make thinking reference context
clearly?*) — answered YES. Validates the **entire chain end-to-end**: migrate →
reclassify (feedback→decision; the injected pattern shows as `[decision]`) → embed (right
corpus via the tsx-by-path fix) → retrieve (0.529) → gate (0.45 floor) → inject → thinking
*uses* it. Also: **no double-footer**, confirming the injector trim. Footer-on-exit
(`Context: used:`) still to be confirmed.

❌→⚠️ **The `/contextus-setup` nudge MISFIRES on a migrated project (finding).**
Third session-start message: *"run /contextus-setup to scaffold `.claude/context/` and
register contextus in this project (one-time)."* — but automation **already has** 56
context files and a live, injecting corpus. Root cause: `session-start-hook.js:126`
nudges purely on *"is there a contextus stanza in the project CLAUDE.md?"*. Automation
has a 22KB CLAUDE.md but **no stanza** — because `migrate-memory` builds the corpus but
never *registers* the project, while only `contextus-setup` writes the stanza. **The two
paths don't converge:** a fully-migrated project falls in the crack — works perfectly,
but nags forever, and the wording ("scaffold `.claude/context/`") is actively wrong when
that dir is already populated. Does NOT block injection (query-hook retrieves by project
basename, stanza-independent). **Fixes to consider:** (a) `migrate-memory --apply` should
write the CLAUDE.md stanza too (converge the paths), or (b) the nudge should distinguish
"no stanza BUT `.claude/context/` populated" (→ *"contextus is active here; add the
CLAUDE.md stanza with /contextus-setup to silence this"*) from "nothing exists" (→
current scaffold message). (a) is cleaner — migration should leave a project as
"registered" as setup does.

🔭 **Follow-up B — claude-mem as a content *source*, not just a hook to clean up (user
clarification, 2026-06-15).** The deeper idea: detect claude-mem and **piggyback off its
worthwhile search results, storing them as context.** claude-mem is reactive
(observational history, searched on demand); contextus is proactive (curated patterns,
auto-injected). Bridge them with a usage-gated ratchet — when a claude-mem observation
is surfaced *and actually used*, graduate it into `.claude/context/` so it injects
proactively next time. Same "was it *used*?" signal as the opus-metrics-critique. Filed
as a v2 Track-B item (gated on usage data — "worthwhile" is undefinable cold). Reuses
`novelty.ts` (dedup), `SOURCE_WEIGHTS` (provenance), and the reclassify heuristic
(observations have no category). See V2_ROADMAP Track B.

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
