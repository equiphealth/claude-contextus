---
name: source-embed-scope
description: "TOP MISS — docs/ dir is not watched, so doc edits serve stale retrieval silently until a full embed. Broader — auto-embed only covers .claude/context/. Scope (user* vs project*) is SETTLED, not the question."
metadata:
  type: question
  tags:
    - sources
    - embedding
    - reembed
    - read-only-sources
    - open-question
---

**SETTLED — the scope axis is NOT the open part.** user\* vs project\* is decided by
where knowledge belongs: user-only preference → `~/.claude/`, project-specific →
`<project>/.claude/`. That's the canonical rule (file-based design). This question is
NOT "which store is canonical" — it's purely about the re-embed *trigger* gap below.

**⚠️ TOP CONCERN (user, 2026-06-15): the `docs/` directory is not watched.** Editing a
doc under `docs/` (a real `projectDocs` source) triggers NO re-embed — retrieval serves
the STALE version silently until a full `pnpm embed`. No error, no nudge. This is the
most dangerous gap because it's silent AND common (docs change often). Fixing
docs-watching is the priority; the broader read-only-source story is secondary.

**OPEN QUESTION** (raised 2026-06-15, re: future extra read-only sources): how should
non-`.claude/context/` sources get (re-)embedded?

**Current reality — auto-embed is project-context-ONLY:**
- The `watch-contexts` PostToolUse hook fires only for `.md` under a `.claude/context/`
  path segment (`watch-contexts.js`). Edits to `docs/`, `~/.claude/memory/`,
  `~/.claude/docs/` trigger NOTHING.
- Session-start reconcile is explicitly scoped to `projectContext`
  (`daemon/server.ts`: `getContentHashes(project, 'projectContext')`) — by design, so
  doc/user rows don't look like orphans.
- So `projectDocs` / `userMemory` / `userDocs` embed ONLY on a full `pnpm embed`. No
  incremental path exists for them.

**Why this bites read-only sources** (the future feature): they're exactly the case that
most wants incremental + cached embedding (large, change rarely, expensive to recompute)
— but today they'd have neither. An upstream `git pull` adding files triggers no
re-embed; and a provider switch (see `gotcha-embedding-provider-switch`) invalidates the
WHOLE table at once because `.meta.json` is per-project, NOT per-source. So there's no
partial re-embed: you can't "re-embed project context but leave the big read-only source."

**Design directions (undecided):**
1. Extend incremental embed (watch + reconcile) to cover all sources, not just
   `.claude/context/`.
2. Per-source embed metadata/granularity so a single-source update or provider switch
   doesn't force a full-table rebuild.
3. For read-only sources specifically: a content-hash cache so unchanged files skip
   re-embedding even across a full rebuild.

Resolve to `decision-*` + likely a V2_ROADMAP entry when the read-only-sources feature
is scoped. Related: `gotcha-embedding-provider-switch`, `reference-query-is-single-vector-dilution`.
