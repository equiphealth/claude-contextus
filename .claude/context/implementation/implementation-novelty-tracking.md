---
name: novelty-tracking
description: How the daemon tracks recently-injected patterns in memory to avoid duplicate context proposals
metadata:
  type: implementation
  tags: [novelty, awareness, capture, daemon]
---

# Novelty Tracking Implementation

The daemon maintains an **in-memory map** of recently-injected pattern names per project, exposed via `GET /novelty`. This powers the awareness hook's "contextus already has patterns on: X, Y, Z" footer to prevent Claude from proposing duplicate context files.

## Data Structure

```typescript
const _recent = new Map<string, string[]>();
// project → [pattern names], most-recent-LAST
```

**Example:**
```typescript
_recent.get("/Users/Anthony.Dawson/src/claude-contextus")
// → ["dev/LOGGING.md", "calibration.md", "dev/DESIGN.md"]
```

## When Patterns Are Recorded

**On successful injection** — `/query` handler calls `recordInjection()` after formatting the injection block:

```typescript
if (kept.length > 0) {
  const patternNames = kept.map(r => r.filename);
  recordInjection(project, patternNames);
}
```

**Only patterns above the floor** are recorded. If the floor drops everything, novelty isn't updated.

## Bounded Window

**Limit:** 12 patterns per project (`NOVELTY_WINDOW` constant)

**Behavior:**
```typescript
export function recordInjection(project: string, patterns: string[]): void {
  if (patterns.length === 0) return;
  
  const cur = _recent.get(project) ?? [];
  // Remove duplicates, then append (so re-injected patterns move to end)
  const next = cur.filter(p => !patterns.includes(p));
  next.push(...patterns);
  
  // Keep last 12
  _recent.set(project, next.slice(-NOVELTY_WINDOW));
}
```

**Why 12?** Enough to prevent proposing patterns from the last few turns, small enough to not bloat memory for a long-lived daemon serving many projects.

## Deduplication

Re-injected patterns **move to most-recent**:

**Before:**
```
["A.md", "B.md", "C.md"]
```

**recordInjection(["B.md", "D.md"]):**
```
["A.md", "C.md", "B.md", "D.md"]
```

B.md moved to the end (it was re-injected).

## API: GET /novelty

**Endpoint:**
```
GET /novelty?project=<absolute-path>
```

**Response:**
```json
{
  "project": "/Users/Anthony.Dawson/src/claude-contextus",
  "recent": [
    "dev/LOGGING.md",
    "calibration.md",
    "dev/DESIGN.md"
  ]
}
```

**Used by:** UserPromptSubmit hook's awareness footer (after the main query completes).

## Session-Scoped by Design

**In-memory only** — Resets on daemon restart.

**Why not persist?** This is a **soft hint** to avoid proposing patterns that were just injected minutes ago. A daemon restart (rare) resetting it is fine — the awareness footer just won't list patterns until the next injection. Persisting to disk would add complexity for minimal gain.

## Awareness Footer Usage

**Hook flow:**

1. **UserPromptSubmit** triggers
2. **Daemon query** → injects patterns (or not)
3. **recordInjection()** updates novelty map
4. **Awareness footer** calls `/novelty`
5. **Footer appended:** "contextus already has patterns on: X, Y, Z — only propose if genuinely new"

**Example footer:**
```
Context capture: if this exchange surfaces a NEW reusable insight not already covered by the injected patterns above (a decision, gotcha, workflow, or reference), end your response with "Context: propose: <topic-name>". Use /create-context if accepted. If you sense missing context that SHOULD exist for this project — a gap you'd want filled in future sessions — ask the user: "Should we capture [topic] as a context pattern?" NOVELTY CHECK — contextus already has patterns on: dev/LOGGING.md, calibration.md, dev/DESIGN.md. Only propose if your insight is genuinely not covered by those.
```

## Memory Overhead

**Per project:** ~12 filenames × ~40 chars avg = ~480 bytes
**For 100 projects:** ~48KB

Negligible for a long-lived daemon.

## Code Location

- `lib/capture/novelty.ts` — Core logic (recordInjection, noveltyFor, resetNovelty)
- `daemon/server.ts` — API endpoint (lines 591-596)
- `daemon/server.ts` — recordInjection call after injection (around line 401)
- `scripts/awareness-hook.js` — Consumes `/novelty` to build footer

## Related

- **Awareness hook** — Uses novelty list to avoid duplicate proposals
- **/create-context** — Invoked when Claude proposes a new pattern
- **Injection floor** — Only patterns above floor get recorded in novelty
