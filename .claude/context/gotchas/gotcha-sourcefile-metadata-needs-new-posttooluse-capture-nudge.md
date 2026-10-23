---
name: sourcefile-metadata-needs-new-posttooluse-capture-nudge
description: >-
  Resolved: sourceFile capture-nudge reuses watch-contexts.js + /notify's
  existing not_in_any_source signal, no new hook needed
metadata:
  type: gotcha
  tags:
    - hooks
    - capture
    - posttooluse
    - metadata
---

## Resolved design (supersedes the "needs a new hook" framing)

[Issue #95](https://github.com/equiphealth/claude-contextus/issues/95) needs `sourceFile`/`sourceContentHash` populated when a capture correlates with a real Read/Write/Edit. Originally this looked like it needed a brand-new PostToolUse hook, separate from `scripts/watch-contexts.js`. It doesn't — the existing hook and the existing `/notify` endpoint already have the pieces, they just aren't wired together for this purpose yet.

**Key fact that unlocks this**: `daemon/server.ts`'s `/notify` handler (`determineSource`) already returns `{ok: true, embedded: false, reason: 'not_in_any_source'}` when the touched file isn't a configured contextus source. `watch-contexts.js` never sees this for non-`.md` files today because `isMarkdownFile(file)` short-circuits BEFORE calling `/notify` at all (see current `main()` — `if (!isMarkdownFile(file)) return emit({ continue: true })`).

**Resolved plan — one hook, two branches, no new hook registration:**

- **Write/Edit/MultiEdit/NotebookEdit** (existing matcher): drop/loosen the client-side `isMarkdownFile()` early-return so `/notify` gets called for the touched file regardless of extension. Branch on the response: context file (`embedded`) → today's re-embed behavior, unchanged. `not_in_any_source` → this was a real code/non-context file edit → emit a capture-nudge (`additionalContext`/`systemMessage`, the same mechanism already used for the YAML-error case) naming that path as the `sourceFile` candidate.
- **Read** (new matcher addition): keep a client-side pre-filter (restrict to `.md`/known context paths) BEFORE calling anything — this is what avoids the frequency/fatigue problem flagged in the original gap analysis (Read fires on every exploratory file access, most of which are not insight-worthy). Read-triggered actions stay narrow (e.g. context-file hit tracking), not a capture nudge.

**Deliberate scope narrowing, and its cost**: nudging only on Write/Edit (not on Read of non-context code) means genuine insights discovered purely by reading code — without ever editing it — won't get an automatic `sourceFile` nudge. This session's own tag-comma-corruption discovery (found by reading `file-to-rows.ts`, never edited) is exactly that missed case. Accepted tradeoff: Write/Edit is a much rarer, stronger "this file mattered" signal than Read, which is why scoping the nudge to it is what keeps this a single cheap hook instead of adding a second, noisier one.

**Remaining implementation detail**: computing `sourceContentHash` for a non-context file requires hashing its content somewhere (client-side in the hook, or daemon-side in `/notify`'s non-context branch) — today's `/notify` path only reads/hashes content for files it's about to embed (context files); the non-context branch currently does no file I/O beyond the path check. That read-and-hash step needs to be added specifically for this feature.

## Tracking

See [issue #95](https://github.com/equiphealth/claude-contextus/issues/95), updated to reflect this single-hook design.

