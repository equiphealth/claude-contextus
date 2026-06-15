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

⚠️ **CONTEXT.md is hand-maintained and drifts — nothing keeps it in sync.** When I
recategorized the 4 own-corpus files, the index didn't follow (no link rot, because it
only listed 3 of 20 files to begin with — it was stale long before this). Two gaps:
(1) `migrate-memory` writes context files but never regenerates the index; (2) there's
no `embed`-time check that CONTEXT.md matches the files on disk. So the index silently
diverges from the corpus. For *retrieval* this is harmless — CONTEXT.md is in the embed
exclude globs (`**/CONTEXT.md`), so it's never embedded and drift can't pollute
injection. But it's the human-facing map, and a stale map misleads. **Follow-up worth
considering:** have `migrate-memory --apply` (and `contextus-setup`) emit/refresh
CONTEXT.md from frontmatter, the same way MEMORY.md is generated. Filed as friction,
not a blocker — fixed by hand here.
