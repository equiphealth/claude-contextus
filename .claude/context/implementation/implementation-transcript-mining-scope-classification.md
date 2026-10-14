---
name: transcript-mining-scope-classification
description: "FIXED: transcript mining now classifies each extracted pattern as scope:project or scope:user instead of hardcoding project scope"
metadata:
  type: implementation
  tags: ["transcript-mining", "scope"]
---

## What Changed

Transcript mining used to write every extracted pattern with `scope: 'project'` unconditionally (`writePattern` in `scripts/mine-transcripts.ts`), regardless of whether the pattern was actually about this codebase or about a cross-project tool/skill/workflow. Found via a real dry-run against this project's own session history, which surfaced a pattern about an unrelated Claude Code skill the user had tried — that pattern would have been permanently written into this project's `.claude/context/` had the run not been `--dry-run`.

## Fix

1. **`lib/transcript/extractor.ts`** — `ExtractedPattern` gained a `scope: 'project' | 'user'` field. The extraction prompt (`EXTRACTION_PROMPT`) now asks the LLM to classify each pattern using the same rule already given to the *live* capture flow: `project` if specific to this codebase's architecture/files/domain rules, `user` if it's a tool/skill/workflow insight that applies regardless of project. `parseExtractionResponse` fails closed to `'project'` on anything other than the literal string `'user'` (missing field, typo, hallucinated value) — a mis-scoped-as-project pattern is easy to notice and move later; a real project insight silently landing in the user's cross-project corpus is more likely to just get lost.
2. **`scripts/mine-transcripts.ts`**'s `writePattern` now forwards `pattern.scope` to `/capture` instead of the hardcoded literal.

No change needed to `isDuplicate`'s dedup `/query` call — it already passes `cwd`, and the daemon's `handleQuery` resolves `projectScope` as `[projectId, '__user__']`, so dedup already searches across both scopes regardless of which one a pattern ultimately lands in.

## Tests

- `tests/transcript-extractor.test.ts` — scope preserved when `'user'`/`'project'`, defaults to `'project'` on missing or invalid values.
- `tests/mine-transcripts-write-pattern.test.ts` — a real ephemeral HTTP server captures the actual `/capture` request body to prove `scope` is forwarded per-pattern, not hardcoded (two patterns with different scopes in one test, asserting both request bodies differ correctly).

Superseded gotcha: `gotchas/gotcha-transcript-mining-hardcodes-project-scope.md` (archived via `/delete` in the same commit as this fix, per the bug-documentation lifecycle).
