---
name: extraction-source-candidates
description: Ranked list of potential context extraction sources beyond transcripts — PRs, issues, CI logs, review comments
metadata:
  type: decision
  tags: ["extraction", "sources", "v2", "design"]
---

# Context extraction source candidates

**Status:** Design inventory. Transcripts shipped (v0.9.0); git-log on roadmap; others evaluated here.

**Key insight (squash-merge overlap):** In repos that use PR descriptions as squash-merge commit messages, git log already contains the PR "why." The unique value of PR mining in that case is **review comments only** — enforced conventions, rejected approaches, "we tried X but it broke because Y." Repos with terse commit messages and rich PR bodies get value from both. The extraction tool should detect/adapt.

## Source ranking (signal-to-noise ratio)

### Tier 1 — high signal, structured, accessible

| Source | Signal type | Access | Extraction difficulty |
|--------|------------|--------|----------------------|
| **Session transcripts** | Decisions, gotchas, workflows in dialogue | Local `.jsonl` files | SHIPPED (v0.9.0) |
| **Closed/merged PRs** | Intent (description), enforced patterns (reviews), tradeoffs (discussion) | `gh pr list/view` | Medium — structured fields, but review threads need threading logic |
| **GitHub Issues (closed)** | Root causes, reproduction steps, domain knowledge, workarounds | `gh issue list/view` | Medium — signal buried in comment threads, need to identify "resolution" comment |

### Tier 2 — moderate signal, needs filtering

| Source | Signal type | Access | Extraction difficulty |
|--------|------------|--------|----------------------|
| **Git log/diffs** | Recurring code patterns, implicit conventions | `git log -p` | Hard — diffs show "what" not "why"; need LLM to infer pattern from repetition. **Note:** overlaps with PR bodies on squash-merge repos. |
| **CI failure logs** | Platform quirks, flaky test patterns, timeout thresholds | GitHub Actions API | Hard — logs are verbose; need pattern detection across multiple runs |
| **Code review comments (cross-repo)** | Team style guide, enforced conventions | `gh api` | Medium — comments are terse but pattern repetition is strong signal |

### Tier 3 — rich but access-gated (external systems)

| Source | Signal type | Access | Extraction difficulty |
|--------|------------|--------|----------------------|
| **Confluence/wiki** | Formal documentation, architecture decisions, runbooks | Atlassian MCP | Easy extraction but often stale — need freshness signal |
| **Jira issues** | Requirements context, acceptance criteria, known limitations | Atlassian MCP | Medium — structured fields (summary, description, comments) but signal varies wildly by team discipline |
| **Google Docs** | Design docs, RFCs, meeting notes, decision records | Google Drive MCP (future) | Medium — unstructured prose, needs section extraction |
| **Slack/Teams threads** | Ad-hoc decisions, incident context, tribal knowledge | Slack MCP (future) | Hard — conversational, needs topic extraction + threading |
| **claude-mem observations** | Reactive patterns, session discoveries | MCP tool | PLANNED (Track B, usage-gated) |

## External source strategy

External sources (Confluence, Jira, Google Docs, Slack) share common challenges:

1. **Access** — Require MCP servers or API tokens; can't assume availability
2. **Freshness** — Unlike git/transcripts, external docs can go stale silently. Need `lastModified` tracking + periodic re-scan.
3. **Scope** — Can't mine all of Confluence. Need user to specify: "watch this space" or "track issues in project X."
4. **Permissions** — May contain sensitive content not suitable for `.claude/context/` (which is git-committed). Need a "private extraction" mode or user-level-only output.

**Implementation approach:** Leverage MCP servers already available (Atlassian plugin exists). Start with user-directed extraction ("mine this Confluence page" / "extract patterns from JN-123") before attempting automated watching. Same pipeline as PR mining: fetch → LLM extract → dedup → write to staging.

## Why PRs are the strongest next candidate

1. **Structured data** — title, body, review comments, file list, labels are separate fields
2. **Validated decisions** — merged = someone approved the approach
3. **"Why" signal** — PR descriptions explain intent; review comments explain constraints
4. **Pattern enforcement** — repeated reviewer feedback ("we always X because Y") is an unindexed style guide
5. **Accessible** — `gh pr list --state merged --limit N` + `gh pr view N --comments`
6. **Dedup-friendly** — PR number is a natural key; same PR won't be mined twice

## Extraction approach for PRs

```
For each merged PR (recent N or since watermark):
  1. Extract: title, body, review comments, files changed
  2. LLM prompt: "What reusable patterns, decisions, or gotchas
     does this PR + its review discussion establish?"
  3. Filter by confidence (same 0.6 threshold as transcript mining)
  4. Dedup against existing corpus (same 0.82 similarity check)
  5. Write to .claude/context/ in staging mode
```

## Open questions

- Should PR mining be per-repo or cross-repo (mine PRs from linked projects)?
- What's the lookback window? (PRs age better than transcripts — a 6-month-old PR decision is still valid)
- Should we weight reviewer comments higher than author description?
- How to handle PRs with 50+ review comments? (Chunk by thread? Summarize?)
