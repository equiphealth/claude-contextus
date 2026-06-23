---
name: activity-triggered-retrieval
description: Design consideration — inject context based on which files are being edited, not just prompt text similarity
metadata:
  type: decision
  tags: ["retrieval", "injection", "v2", "design"]
---

# Activity-triggered retrieval (design consideration)

**Status:** Proposed (not yet implemented). Identified via Sonnet feedback on cross-project injection gaps.

## The Problem

Semantic search against the user's prompt misses context when:
- The user says "bump to 1.2.0" but the relevant pattern is about "always update pyproject.toml + __init__.py + RELEASE_REASON.md together"
- The prompt is terse ("fix the version") but the context pattern uses different vocabulary
- The user is mid-implementation and their prompt is about a specific line, not the workflow

The knowledge exists in the corpus but the prompt doesn't semantically match it.

## The Idea

Detect which files are being edited (from tool_use blocks, git status, or the hook's cwd) and use that as an additional retrieval signal:

```
Signal sources:
- Files mentioned in recent tool_use (Read, Edit, Write)
- Files in git staging area (git diff --cached)
- File paths mentioned in the prompt text
```

A context pattern could declare file-path triggers:

```yaml
metadata:
  type: reference
  triggers:
    files: ["pyproject.toml", "__init__.py", "CHANGELOG.md"]
    mode: "any"  # inject if ANY of these are being touched
```

When the hook detects one of those files in the activity signal, it injects the pattern regardless of semantic similarity to the prompt.

## Trade-offs

**Pros:**
- Catches workflow patterns that semantic search misses
- Zero effort for the user — just touching the file is enough
- Complements embedding-based retrieval (different failure modes)

**Cons:**
- Requires parsing tool_use history or git state (adds latency)
- Could over-inject if trigger files are frequently touched
- Needs careful scoping — not every file edit is a signal
- Adds a new metadata schema to context files

## Possible Implementation Layers

1. **Prompt-enrichment** (simplest): Before embedding the query, append detected filenames to the search text. If "pyproject.toml" appears in the corpus pattern's description, it'll rank higher.
2. **Explicit triggers** (medium): File-match rules in frontmatter metadata, checked before/alongside vector search.
3. **Activity window** (richest): Track last N tool_use calls, build a "what's being worked on" context, use that as a second retrieval vector.

## Open Questions

- Should this be opt-in per pattern (explicit triggers) or automatic (prompt enrichment)?
- What's the latency budget? Parsing git status adds ~50ms.
- How does this interact with the injection floor? Skip it for trigger matches?
- Is this a v2 feature or can prompt-enrichment be a quick win?
