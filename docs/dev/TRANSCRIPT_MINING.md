# Transcript Mining

Extract reusable patterns from Claude Code session transcripts — both at setup (bootstrap) and on a recurring schedule (safety net for missed captures).

## Problem

Even with staging mode active, not every capture-worthy insight gets written during a live session. Implementation focus, context limits, and detection gaps mean patterns slip through. Those patterns are preserved in the session logs — we just need to extract them.

## Session Log Format

Claude Code stores session transcripts at `~/.claude/projects/<slug>/*.jsonl`.

**Slug derivation:** absolute project path with `/` → `-`, leading `-`.
Example: `/Users/foo/src/my-project` → `-Users-foo-src-my-project`

**Message types (one JSON object per line):**

| Type | Keys of Interest | Content |
|------|-----------------|---------|
| `user` | `message.content` (string), `cwd`, `timestamp` | User prompts — domain knowledge, requirements, corrections |
| `assistant` | `message.content` (list of blocks) | Claude responses — decisions, explanations, reasoning |
| `attachment` | `attachment` | Tool results (file contents, command output) |
| `ai-title` | `aiTitle` | Auto-generated session title |
| `last-prompt` | `leafUuid` | Points to latest message (for resumption) |

**Assistant content blocks:**

| Block Type | Mining Value | Notes |
|-----------|-------------|-------|
| `thinking` | **HIGH** — contains deliberation, tradeoffs, rejected alternatives, reasoning | Not shown to user; rich in "why" context |
| `text` | **HIGH** — decisions communicated, explanations, patterns stated | The visible response |
| `tool_use` | **MEDIUM** — shows what was searched/read/written; useful for tracing claude-mem queries, file patterns | Could mine tool calls to other memory systems |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Trigger: setup / scheduled / manual                         │
├─────────────────────────────────────────────────────────────┤
│  1. Discover sessions (filter by watermark)                  │
│  2. Parse JSONL → conversation turns                         │
│  3. Chunk turns into extractable windows                     │
│  4. LLM extraction (Haiku) → candidate patterns             │
│  5. Dedup against existing corpus (novelty check)            │
│  6. Write via /capture endpoint (staging mode)               │
│  7. Update watermark                                         │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: Session Discovery

```typescript
function discoverSessions(projectPath: string, since?: Date): string[] {
  const slug = projectPath.replace(/\//g, '-');  // leading - included
  const dir = path.join(homedir(), '.claude/projects', slug);
  // Filter *.jsonl modified after `since` (watermark)
  // Sort by mtime ascending (oldest first)
}
```

**Scope options:**
- `"project"` — scan only the current project's sessions
- `"all"` — scan all project dirs (for user-level pattern extraction)

### Step 2: Parse into Conversation Turns

A "turn" = one user message + one assistant response (all its content blocks).

```typescript
interface Turn {
  timestamp: string;
  userContent: string;
  assistantThinking: string;   // concatenated thinking blocks
  assistantText: string;       // concatenated text blocks
  toolCalls: ToolCall[];       // name + truncated input (for memory system mining)
  sessionId: string;
}
```

### Step 3: Chunk into Extraction Windows

Individual turns may be too small for meaningful extraction. Group into windows of ~3-5 turns (conversation flow preserves context). Overlap by 1 turn to catch cross-turn patterns.

**Token budget per window:** ~4000 tokens input to Haiku (keeps cost low).

**Filtering heuristics (skip uninteresting turns):**
- Skip turns where assistant only used tool_use (pure mechanical work)
- Skip turns with <50 chars of user+assistant text (trivial exchanges)
- Prioritize turns with thinking blocks >500 chars (deep reasoning)
- Prioritize turns where user explains something (domain knowledge signals: "the reason is", "we do X because", "the pattern here is")

### Step 4: LLM Extraction

Send each window to Haiku with an extraction prompt:

```
You are extracting reusable knowledge from a development session transcript.

For each window, identify patterns that would be useful in FUTURE sessions:
- Architectural decisions (and WHY they were made)
- Gotchas discovered (surprising behaviors, failure modes)
- Conventions established (naming, structure, workflow)
- Domain knowledge shared (how systems work, constraints)
- Tradeoffs considered (what was weighed, what won)

For each pattern found, output:
{
  "patterns": [
    {
      "category": "decision|gotcha|reference|implementation|tradeoff|arch",
      "slug": "kebab-case-name",
      "description": "one-line summary",
      "body": "full explanation with context",
      "confidence": 0.0-1.0,
      "source_turns": [0, 1]  // which turns in the window
    }
  ]
}

Rules:
- Only extract patterns useful for FUTURE work (not one-time fixes)
- Include the "why" — a pattern without reasoning is just trivia
- Prefer fewer high-quality patterns over many shallow ones
- Confidence < 0.5 = skip (uncertain if reusable)
```

**Provider chain:** Bedrock Haiku (primary) → Ollama qwen2.5:3b (fallback, lower quality but free)

### Step 5: Dedup / Novelty Check

Before writing, check each candidate against existing corpus:
1. Semantic similarity via existing embedding pipeline
2. If similarity > 0.85 to existing pattern → skip (already captured)
3. If similarity 0.7-0.85 → flag as "possible update to existing" (append, don't create)

### Step 6: Write via /capture

Use the existing `POST /capture` endpoint:
```typescript
await fetch('http://127.0.0.1:37800/capture', {
  method: 'POST',
  body: JSON.stringify({
    category: pattern.category,
    slug: pattern.slug,
    description: pattern.description,
    body: pattern.body,
    tags: ['transcript-mined'],
    cwd: projectPath,
    scope: 'project'  // or 'user' for cross-project patterns
  })
});
```

The `transcript-mined` tag distinguishes these from hand-captured or live-captured patterns — useful for quality tracking.

### Step 7: Watermark

```json
// ~/.contextus/transcript-state.json
{
  "version": 1,
  "projects": {
    "-Users-foo-src-my-project": {
      "lastScanned": "2026-06-22T00:00:00Z",
      "lastSessionFile": "abc123.jsonl",
      "patternsExtracted": 12,
      "sessionsProcessed": 8
    }
  }
}
```

## tool_use Mining (Future)

`tool_use` blocks record every tool call Claude made. This enables mining *other* memory systems:

**claude-mem queries:**
```json
{"type": "tool_use", "name": "mcp__plugin_claude-mem_mcp-search__memory_search", "input": {"query": "..."}}
```

If Claude searched claude-mem for something and found a useful result, that's a signal the pattern should be promoted to contextus (proactive injection > reactive search).

**File read patterns:**
Repeated reads of the same files across sessions → those files contain knowledge worth capturing as context.

**Grep patterns:**
What Claude searches for repeatedly → missing from the corpus.

## Triggers

| Trigger | Scope | When |
|---------|-------|------|
| `/contextus-setup` | All history (last 7 days) | First install |
| SessionStart hook | Delta since last scan | Every new session |
| Manual (`pnpm mine-transcripts`) | Configurable | On demand |
| Daemon idle timer | Delta since last scan | When daemon has nothing else to do |

**SessionStart is the recommended recurring trigger.** Cheap (only processes delta), no cron setup required, runs in background without blocking the session.

## Cost Model

- **Per session:** ~4000 tokens input × 3-5 windows = ~15-20k tokens to Haiku ≈ $0.005
- **First scan (7 days, ~10 sessions):** ~$0.05
- **Recurring (1-2 sessions per day):** ~$0.01/day
- **Free fallback:** Ollama qwen2.5:3b (lower extraction quality, but zero cost)

## Configuration

```jsonc
// in contextCapture block
"transcriptMining": {
  "enabled": true,
  "trigger": "session-start",     // session-start | manual | off
  "lookback": "7d",               // first scan window
  "provider": "bedrock",          // bedrock | ollama | anthropic
  "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  "confidenceThreshold": 0.6,     // minimum extraction confidence
  "scope": "project",             // project | all
  "includeThinking": true,        // mine thinking blocks (richest source)
  "maxSessionsPerScan": 10        // cap per trigger (cost control)
}
```

## Privacy Considerations

- Transcripts never leave the machine (Haiku via Bedrock or local Ollama)
- Extracted patterns go through the same staging/git flow — user reviews before committing
- `transcript-mined` tag makes provenance visible
- `includeThinking: false` option for users uncomfortable mining internal reasoning

## Implementation Plan

1. **`lib/transcript/parser.ts`** — JSONL reader, turn grouping, window chunking
2. **`lib/transcript/extractor.ts`** — LLM extraction (Haiku prompt, response parsing)
3. **`lib/transcript/state.ts`** — Watermark read/write
4. **`scripts/mine-transcripts.ts`** — CLI entry point (`pnpm mine-transcripts [--project] [--since]`)
5. **Integration:** SessionStart hook calls daemon `/mine` endpoint (background, non-blocking)
6. **Config:** Add `transcriptMining` to config schema + all config locations

## Open Questions

1. Should thinking blocks get equal weight to text, or higher? (Thinking often has the "why" that text omits)
2. Window size: 3-5 turns, or adaptive based on turn length?
3. Should the extractor see tool results too? (File contents give context but massively inflate token count)
4. How to handle very long sessions (100+ turns)? Sample or process all?
5. Should recurring scans re-process sessions that were already scanned but produced 0 patterns? (Maybe the extractor improves, or corpus context changes what's "novel")

---

*Created: 2026-06-22*
