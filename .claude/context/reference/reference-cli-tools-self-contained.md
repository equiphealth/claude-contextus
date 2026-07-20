---
name: cli-tools-self-contained
description: CLI tools should be comprehensive and self-contained — skills execute once and present results
metadata:
  type: reference
  tags: ["cli", "skills", "patterns"]
---

# CLI Tools Should Be Self-Contained

## Problem
When a skill needs to present comprehensive information (e.g., usage stats + corpus size), poorly-designed CLIs force the skill to stitch together data from multiple sources:

```bash
# BAD: Skill runs 3 separate commands
tsx context-stats.ts --json          # usage data
ls .claude/context/*/*.md | wc -l   # corpus size
stat lancedb | grep mtime           # last embed timestamp
```

This is noisy, fragile, and violates the silent execution pattern.

## Solution
**CLI tools output everything relevant in one call**

```bash
# GOOD: One command, complete output
tsx context-stats.ts --json
```

```json
{
  "project": "claude-contextus",
  "corpus": {
    "totalFiles": 42,
    "lastEmbedded": "2026-06-30"
  },
  "summary": { ... },
  "patterns": [ ... ]
}
```

## Pattern
1. **Identify what the skill will present** — If the output includes "corpus has N files", the CLI must provide N
2. **Include metadata in output** — Corpus stats, last-modified timestamps, config state, etc.
3. **Make it queryable** — Daemon `/health` endpoint is another good source for comprehensive metadata

## Examples

### context-stats
**Before:** Skill ran `ls | wc -l` to get corpus size
**After:** CLI includes `corpus: { totalFiles, lastEmbedded }` in output

### context-doctor (future)
**Should output:** All diagnostic state in one JSON blob (daemon health, corpus state, config mismatches, stale patterns)
**Not:** Force skill to query daemon, check files, run grep separately

### context-status
**Should output:** Full dashboard (daemon uptime, embedding model, recent injections, corpus size, config summary)
**Not:** Just daemon health, forcing skill to read config files separately

## Why This Matters
1. **Skills stay simple** — One tool call, present results
2. **Silent execution** — No mid-flow bash commands visible in conversation
3. **Testable** — CLI outputs complete, parseable JSON
4. **Maintainable** — Data assembly logic lives in one place (the CLI), not scattered across skill files

## Implementation Checklist
When writing a CLI tool that a skill will invoke:
- [ ] Identify all data the skill needs to present
- [ ] Add helper functions to gather metadata (corpus size, timestamps, config state)
- [ ] Include metadata in JSON output (`corpus`, `config`, `daemon` top-level keys)
- [ ] Add same metadata to human-readable output (header section)
- [ ] Test: can skill execute CLI once and present everything? If not, CLI is incomplete.
