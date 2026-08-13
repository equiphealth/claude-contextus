---
name: transcript-mining-hardcodes-project-scope
description: Transcript mining always writes extracted patterns as scope:project, even when the pattern is actually about a cross-project tool/skill/workflow — no classification step exists
metadata:
  type: gotcha
  tags: ["transcript-mining", "scope", "user-vs-project"]
---

## Symptom

A dry-run of `mine-transcripts.ts` against this project's own session history surfaced a pattern about a `hostile-critic` skill the user had tried in an unrelated context — cross-project, personal-workflow knowledge, not specific to claude-contextus. If the run hadn't been `--dry-run`, that pattern would have been written into *this* project's `.claude/context/` via `/capture`, permanently mis-scoped.

## Root Cause

Two places currently make no distinction between project-specific and cross-project/personal knowledge:

1. **`lib/transcript/extractor.ts`'s `EXTRACTION_PROMPT`** never asks the LLM to classify scope — it only asks for `category`/`slug`/`description`/`body`/`confidence`/`source_turns`. `ExtractedPattern` has no `scope` field at all.
2. **`scripts/mine-transcripts.ts`'s `writePattern`** hardcodes `scope: 'project'` in every `/capture` POST body (see the fetch call around line 210) — there's no code path that could write `scope: 'user'` even if it wanted to.

This is a real gap because the *live* capture flow (the per-prompt capture instructions injected by the SessionStart/UserPromptSubmit hooks) already has explicit ROUTING guidance for this exact decision ("Project-specific insights → cwd scope:project; Cross-project/personal patterns → scope:user") — that judgment call exists and is exercised every session for live capture, but was never extended to the mining pipeline.

## Proposed Fix (not yet implemented)

Add a `scope: "project" | "user"` field to the extraction JSON schema in `EXTRACTION_PROMPT`, with a rule along the lines of: *user-scoped if the pattern is about a tool/skill/workflow used across projects, not specific to this codebase's architecture, files, terminology, or domain*. Thread it through:

- `ExtractedPattern` interface (add `scope: 'project' | 'user'`)
- `parseExtractionResponse` (validate + default to `'project'` if the LLM omits/mangles it — fail closed, since a mis-scoped-as-project pattern is easy to notice and move later, while a real project insight silently landing in the user's cross-project corpus is more likely to just get lost)
- `writePattern`'s `/capture` call — pass `pattern.scope` instead of the hardcoded string literal

Considered and rejected: a cheaper heuristic post-filter (keyword/path matching against the project's own file paths/package names) — cruder, since a project-specific insight that happens not to mention any file paths would get misclassified as user-scope. The LLM already has the full transcript window in context for this exact window, so it can reason about it the same way a human skimming the transcript would; a heuristic can't.

## Why This Matters

Mining is unsupervised (fire-and-forget from SessionStart, or manual `/mine-transcripts` — no per-pattern human review before `/capture` writes it, only the dry-run flag if a human bothers to check first). Getting scope right at extraction time is the only checkpoint; there's no later curation step in the recurring-trigger design (`decisions/decision-transcript-mining-recurring.md`) that would catch a mis-scoped pattern after the fact.
