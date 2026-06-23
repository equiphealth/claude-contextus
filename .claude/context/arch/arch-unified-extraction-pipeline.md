---
name: unified-extraction-pipeline
description: One extraction system with pluggable source adapters — transcripts, PRs, Jira, Confluence share a pipeline
metadata:
  type: arch
  tags: ["extraction", "sources", "architecture", "v2"]
---

# Unified extraction pipeline

**Decision:** Build ONE extraction system with pluggable source adapters, not separate mining scripts per source. The transcript miner (v0.9.0) is the first adapter — generalize it when PR mining ships.

## Architecture

```
Source adapters (fetch + format)    Shared pipeline (extract → filter → dedup → write)
├── transcript (local .jsonl)       ├── LLM extraction (Haiku, shared prompt template)
├── pr-reviews (gh CLI)             ├── Confidence filter (0.6 threshold)
├── jira (Atlassian MCP)            ├── Corpus similarity dedup (0.82)
├── confluence (Atlassian MCP)      ├── Cross-source dedup (within batch)
├── git-log (local git)             ├── Watermark update (per-source tracking)
└── (future: google docs, slack)    └── Staging write (.claude/context/)
```

## Source adapter contract

Each adapter implements:

```typescript
interface SourceAdapter {
  name: string;                          // "transcript" | "pr" | "jira" | ...
  fetchItems(config: SourceConfig): AsyncIterable<ExtractableItem>;
  formatForExtraction(item: ExtractableItem): string;  // text blob for LLM
  getWatermarkKey(item: ExtractableItem): string;      // dedup key (PR#, issue key, session path)
}

interface ExtractableItem {
  id: string;              // unique key (pr:org/repo#142, jira:JN-456, session:path)
  title: string;
  content: string;         // pre-formatted text for extraction
  metadata: Record<string, unknown>;  // source-specific (files changed, labels, etc.)
}
```

## Shared filtering config

All sources support the same filter shape — include/exclude by title pattern and labels:

```jsonc
{
  "extraction": {
    "pr": {
      "repo": "auto",                    // git remote get-url origin → parse
      "include": {
        "titleMatch": ["feat:", "fix:"], // glob patterns on title (OR logic)
        "labels": ["architecture"]       // include if ANY label matches
      },
      "exclude": {
        "titleMatch": ["deps:", "chore:"],
        "labels": ["dependencies", "automated", "wontfix"]
      },
      "lookback": "6m"
    },
    "jira": {
      "project": "JN",                   // required
      "include": {
        "titleMatch": ["*"],             // default: everything
        "issueTypes": ["Bug", "Story"]
      },
      "exclude": {
        "titleMatch": ["[AUTO]*"],
        "labels": ["wontfix", "duplicate", "no-context"]
      },
      "lookback": "3m"
    }
  }
}
```

**Filter logic:** Include is permissive (OR across patterns), exclude is authoritative (any match → skip). Exclude wins over include. Labels use exact match; titles use glob patterns.

## Why unified (not per-source scripts)

1. **DRY** — The extraction LLM prompt, confidence threshold, dedup logic, and staging write are identical across sources. Duplicating = drift.
2. **Consistent UX** — `pnpm mine --source pr` / `pnpm mine --source jira` / `pnpm mine --all`. One CLI, one watermark file, one log format.
3. **Cross-source dedup** — A Jira ticket and its linked PR often surface the same pattern. Only a unified system can dedup across them.
4. **Incremental generalization** — Transcript adapter exists today. Adding PR adapter = ~100 LOC (fetch + format). No pipeline changes.

## Source provenance

Every extracted file carries its origin:

```yaml
metadata:
  type: gotcha
  source: "pr:org/repo#142"        # or "jira:JN-456", "confluence:page-id", "transcript:session-path"
  extractedAt: "2026-06-23"
```

Enables: traceability, per-source governance, staleness detection, re-extraction on source update.

## Implementation path

1. Refactor `mine-transcripts.ts` → extract shared pipeline into `lib/extraction/pipeline.ts`
2. Move transcript-specific logic into `lib/extraction/adapters/transcript.ts`
3. Build `lib/extraction/adapters/pr.ts` (first external adapter)
4. Generalize CLI: `pnpm mine --source <name>` (backward-compat: bare `pnpm mine-transcripts` still works)
5. Add Jira/Confluence adapters as needed (MCP-based fetch)
