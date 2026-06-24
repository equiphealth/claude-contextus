# Usage Feedback Loop — Design Document

**Status:** Draft  
**Author:** Opus (design), Sonnet (implementation)  
**Date:** 2026-06-24  
**Depends on:** v1 injection pipeline (shipped), Stop hook (exists), session-state (exists)

---

## Overview

This document specifies how contextus closes its feedback loop: tracking not just what was *retrieved* and *injected*, but what was *used*. Three phases, each building on the previous.

| Phase | Deliverable | Unblocks |
|-------|-------------|----------|
| 1 | Stop hook upgrade + usage rating log | All Phase 2/3 work, Track B |
| 2 | `/context-stats`, `/context-review`, `/context-doctor` | Evidence-driven curation |
| 3 | `/promote-context`, `/archive-context`, `/merge-context` | Corpus lifecycle management |

---

## Phase 1: Stop Hook + Usage Evaluation

### Current State (already implemented)

The Stop hook (`scripts/stop-evaluation.js`) already:
1. Reads the session state to get injected patterns (via `~/.contextus/.session-state.json`)
2. Parses the assistant's last turn from the transcript (thinking + response)
3. Logs a `usage_signal` event (footer-based: which patterns were "used" per the provenance footer)
4. Enqueues a calibration eval job (when a campaign is active)

The calibration eval system (`lib/calibration/`) already:
1. Defines the quality gradient: `critical | helpful | mentioned | unused` (`eval-calibration.ts`)
2. Has the eval prompt template and parser (`buildEvalPrompt`, `parseEvalResponse`)
3. Has a multi-provider model caller (`eval-model.ts`: bedrock, ollama, anthropic)
4. Has the worker that drains the queue (`eval-worker-core.ts`)
5. Has campaign state management (`calibration-state.ts`: start/stop/sample-count)
6. Defines the logging schema (`LOGGING.md`: `calibration_eval` event)

### What's Missing

The **eval worker never runs**. Jobs are enqueued but nothing drains the queue. The worker core exists as testable library code, but no daemon loop or periodic trigger consumes it.

Additionally, the system only runs during bounded calibration campaigns (100 samples, then auto-disables). For continuous usage feedback, we need an always-on mode.

### Design: Dual-Mode Evaluation

```
┌─────────────────────────────────────────────────────────────────┐
│  Stop hook (always)                                              │
│  ├── Parse provenance footer → log usage_signal (instant, free) │
│  └── If evaluateUsage=true:                                      │
│      └── Enqueue eval job → .eval-queue.jsonl                    │
│                                                                   │
│  Daemon eval loop (when queue non-empty)                         │
│  ├── Drain queue → call eval model → parse ratings               │
│  ├── Log calibration_eval event to usage.jsonl                   │
│  ├── Increment campaign counter (if bounded campaign)            │
│  └── Always-on mode: never auto-disable                          │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation

#### 1. Daemon Eval Loop (`daemon/eval-loop.ts`)

A setInterval in the daemon that drains the eval queue. Separated from the main server to keep the retrieval hot path clean.

```typescript
// daemon/eval-loop.ts
import { drainQueue } from '../lib/calibration/eval-worker-core.js';
import { readState } from '../lib/calibration/calibration-state.js';
import { logInfo, logError } from '../lib/logger.js';

const POLL_INTERVAL_MS = 5_000; // check queue every 5s
let timer: ReturnType<typeof setInterval> | null = null;

export function startEvalLoop(): void {
  if (timer) return;
  timer = setInterval(async () => {
    const state = readState();
    if (!state.evaluateUsage) return; // respects campaign off-switch
    try {
      const processed = await drainQueue();
      if (processed > 0) {
        logInfo('Eval loop drained', { processed });
      }
    } catch (err) {
      logError('warn', 'eval-loop', 'Drain failed', {
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, POLL_INTERVAL_MS);
  timer.unref(); // don't keep daemon alive solely for eval
}

export function stopEvalLoop(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
```

**Wire into daemon:** Call `startEvalLoop()` after the server starts listening (in `startDaemon()`), and `stopEvalLoop()` in the SIGINT/SIGTERM handler.

#### 2. Always-On Mode (`calibration-state.ts` enhancement)

Add a new mode to the calibration state:

```typescript
export interface CalibrationState {
  evaluateUsage: boolean;
  /** 'campaign' = bounded (100 samples then auto-disable), 'continuous' = always-on */
  mode: 'campaign' | 'continuous';
  targetSamples: number;
  sampleCount: number;
  startedAt: string | null;
  completedAt: string | null;
  model: EvalModelConfig;
}
```

In `recordSample()`: only auto-disable when `mode === 'campaign'`.

**Default:** `mode: 'continuous'`, `evaluateUsage: true`. The eval runs on every query where context is injected. This is the simplest operational model — no campaigns to manage, data accumulates from first use.

**Justification (vs. S80 "calibration mode without always-on overhead"):** The overhead concern in S80 was about always parsing footers inside the Claude response. The actual cost here is a Haiku call in a background loop — it never blocks prompts, adds no latency to the user's session, and costs ~$0.001/query. The value of continuous data far outweighs the cost. Users who disagree set `usageEvaluation.enabled: false` in config.

#### 3. Config Addition (`plugin.jsonc`)

```jsonc
{
  "config": {
    // ... existing config ...
    "usageEvaluation": {
      // Whether to evaluate injected context usage after each response.
      // Default: true. Set false to disable all evaluation (footer parsing
      // still logs usage_signal events — this only gates the LLM-graded eval).
      "enabled": true,
      // 'continuous' = always-on, 'campaign' = bounded sample then auto-stop.
      "mode": "continuous",
      // Provider + model for the evaluation call (same registry as calibration).
      // Default: Bedrock Haiku (cheapest, reliable, proven in calibration tests).
      "provider": "bedrock",
      "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      // Fraction of injections to evaluate. 1.0 = every injection, 0.5 = half.
      // Reduce if cost is a concern on high-volume projects.
      "samplingRate": 1.0
    }
  }
}
```

**Config type** (add to `lib/config.ts`):

```typescript
export interface UsageEvaluationConfig {
  enabled: boolean;
  mode: 'continuous' | 'campaign';
  provider: LLMProviderType;
  model: string;
  samplingRate: number;
}
```

Merge into `ContextusConfig` alongside existing `calibration` section. The existing `calibration` config remains for backward compatibility; `usageEvaluation` supersedes it for the eval use case.

#### 4. Sampling Gate

In `stop-evaluation.js`, before enqueuing:

```javascript
// Sampling gate: skip evaluation probabilistically when samplingRate < 1.0
const samplingRate = /* read from config */ 1.0;
if (Math.random() > samplingRate) return;
```

#### 5. Stop Hook Enhancement

The existing `stop-evaluation.js` already does most of the work. Minimal changes:

1. Read `usageEvaluation.enabled` (from daemon config, not just `calibration-state.json`)
2. When `usageEvaluation.enabled: true`, always enqueue (not just during campaigns)
3. Add sampling gate

The hook already reads session-state, already parses transcripts, already enqueues jobs. It's functional — we just need to flip the "always enqueue" switch.

```javascript
// Replace:
if (calibrationActive()) { enqueue... }
// With:
if (calibrationActive() || usageEvalEnabled()) { enqueue... }
```

Where `usageEvalEnabled()` reads the plugin.jsonc config:

```javascript
function usageEvalEnabled() {
  try {
    const pluginPath = findPluginJsonc(); // reuse from lib/parse-jsonc.js
    const cfg = readJsonc(pluginPath);
    return cfg?.config?.usageEvaluation?.enabled !== false; // default true
  } catch { return false; }
}
```

#### 6. Eval Queue → Usage Log Schema

The eval worker already logs `calibration_eval` events. For Phase 2 analytics, we also want the raw ratings in a queryable form. Add a per-project usage log:

**File:** `~/.contextus/data/<projectId>/usage-ratings.jsonl`

```json
{
  "timestamp": "2026-06-24T14:23:43.892Z",
  "promptHash": "a3f5c9d2",
  "evaluations": [
    {"pattern": "gotcha-stale-closure", "rating": "critical", "similarity": 0.82},
    {"pattern": "reference-test-setup", "rating": "helpful", "similarity": 0.76},
    {"pattern": "decision-state-mgmt", "rating": "unused", "similarity": 0.48}
  ],
  "weightedScore": 0.68,
  "evalLatencyMs": 234,
  "evalModel": "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}
```

The global `~/.contextus/logs/usage.jsonl` retains the existing `calibration_eval` events for cross-project aggregation. The per-project file enables project-scoped analytics without scanning the global log.

**Implementation:** In `processJob()` (eval-worker-core.ts), after logging the global event, also append to the project-specific file:

```typescript
const projectUsagePath = path.join(
  expandHome('~/.contextus/data'),
  job.project,
  'usage-ratings.jsonl'
);
appendSafe(projectUsagePath, JSON.stringify(projectRating) + '\n');
```

#### 7. Error Handling

| Failure | Behavior |
|---------|----------|
| Eval model unreachable | Log warning, skip this job, leave queue intact for retry |
| Eval parse returns 0 ratings | Log as-is (score = 0); don't discard — a 0-score eval is data |
| Transcript not found | Skip (already handled in current hook) |
| No injection this turn | Skip (already handled: early-return when patterns.length === 0) |
| Daemon restart mid-queue | Queue persists (file-based); next startup resumes draining |

#### 8. Cost Model

| Metric | Estimate |
|--------|----------|
| Queries with injection/day | ~50 (active dev day) |
| Chunks per injection (avg) | 3-5 |
| Eval prompt size | ~500 tokens input |
| Eval response | ~50 tokens output |
| Haiku cost per eval | ~$0.0003 |
| Daily cost (50 queries) | ~$0.015 |
| Monthly cost | ~$0.45 |

At sampling rate 1.0, this is negligible. If a project has unusually high query volume, `samplingRate: 0.5` halves it.

---

## Phase 2: Analytics + Health Tooling

Built on the `usage-ratings.jsonl` data from Phase 1.

### `/context-stats`

**Aliases:** `/ctx-stats`

**Implementation:** `scripts/cli/context-stats.ts` (run via `pnpm context-stats` or as a skill)

**Data sources:**
- `~/.contextus/data/<projectId>/usage-ratings.jsonl` — per-pattern ratings
- `~/.contextus/logs/usage.jsonl` — retrieval + no-inject events (already exists)
- Corpus metadata (LanceDB row listing) — for "never retrieved" detection

**Aggregation logic:**

```typescript
interface PatternStats {
  filename: string;
  category: string;
  retrievalCount: number;
  evalCount: number;
  ratings: { critical: number; helpful: number; mentioned: number; unused: number };
  avgWeightedScore: number;
  lastRetrieved: string | null;
  lastRating: Rating | null;
}

function aggregateUsage(projectId: string, windowDays: number): PatternStats[] {
  const cutoff = Date.now() - windowDays * 86400000;
  // 1. Read usage-ratings.jsonl, filter by timestamp > cutoff
  // 2. Group evaluations by pattern filename
  // 3. Count rating distribution per pattern
  // 4. Read usage.jsonl retrieval events for retrieval count + last-seen
  // 5. Cross-reference with corpus file list for "never retrieved"
  // 6. Sort by avgWeightedScore descending
}
```

**Output sections:**

1. **Summary:** Total queries, injection rate, avg weighted score, eval cost
2. **Top 10 Most Useful:** Sorted by weighted score, min 5 evals
3. **Never Retrieved:** Files in corpus with 0 retrieval events in window
4. **High Retrieval, Low Usage (noisy):** Retrieved 10+ times, avg score < 0.3
5. **Staleness candidates:** Not retrieved in 6+ months

**Flags:**
- `--window 30` (default 30 days)
- `--all` (full history)
- `--json` (JSON output for scripting)
- `--cost` (include eval spend breakdown)

**Skill wrapper:** `skills/context-stats/SKILL.md` invokes `npx tsx scripts/cli/context-stats.ts` with appropriate flags.

### `/context-review`

**Aliases:** `/ctx-review`

**Implementation:** `skills/context-review/SKILL.md` (interactive skill, not a CLI script)

**Logic (runs inside Claude's response):**

1. Read aggregated stats (same as `/context-stats` but filtered to promotion candidates)
2. Promotion threshold: `avgWeightedScore >= 0.6 AND retrievalCount >= 10 AND evalCount >= 5`
3. Present top 10 candidates with stats
4. For each, ask user: promote to CLAUDE.md / promote to .claude/memory/ / skip
5. On promotion:
   - **CLAUDE.md:** Append a section derived from the context file's content. Use the description from frontmatter as the rule text. Add under a `## Contextus-Promoted Patterns` section (create if absent).
   - **`.claude/memory/`:** Create a memory file with the context file's content, converting the metadata type to a memory type (`decision→project`, `gotcha→feedback`, `reference→reference`).
6. Stage the changes (don't commit)

**Promotion format for CLAUDE.md:**

```markdown
## Contextus-Promoted Patterns

<!-- Auto-promoted by /context-review based on usage data. Edit freely. -->

### [pattern-name] (promoted 2026-06-24, score: 0.82)
[content of the context file, minus frontmatter]
```

**Promotion format for `.claude/memory/`:**

```markdown
---
name: [slug from context file]
description: [description from context frontmatter]
metadata:
  type: [mapped type]
  promoted_from: .claude/context/[category]/[filename]
  promoted_at: 2026-06-24
  usage_score: 0.82
---

[content of the context file, minus frontmatter]
```

**Important:** The original context file is NOT deleted. It remains in the corpus and continues to be retrievable. The promotion adds the pattern to a higher-precedence layer — not move, copy-up.

### `/context-doctor`

**Aliases:** `/ctx-doctor` (already exists)

**Implementation:** `scripts/cli/context-doctor.ts` + skill wrapper

**Health checks (ordered by severity):**

| # | Check | Pass | Fail | Fix |
|---|-------|------|------|-----|
| 1 | Daemon alive | `GET /health` returns 200 | Process not running | `pnpm daemon` |
| 2 | Model loaded | health.modelLoaded === true | Still warming or failed | Wait / check provider |
| 3 | Corpus non-empty | LanceDB row count > 0 | No embeddings | `pnpm embed` |
| 4 | Config matches meta | Active model = meta.embeddingModel | Mismatch | Re-embed |
| 5 | Linked projects reachable | stat() each linked path | Path missing | `contextus link --remove` |
| 6 | Eval running | usageEvaluation.enabled + queue draining | Queue growing unbounded | Check eval model |
| 7 | Duplicates | Content-hash collision across files | 2+ files, same hash | `/merge-context` |
| 8 | Stale patterns | Not retrieved in window (config: 180 days) | Old patterns accumulating | `/archive-context --stale` |
| 9 | Noisy patterns | Retrieved but avg score < 0.3 over 10+ evals | Low-value injections | Review / rewrite / archive |

**Duplicate detection:**
- Compute SHA-256 of file content (post-frontmatter body only)
- Group by hash; any group with 2+ files = duplicate
- Also flag near-duplicates: same filename stem across different categories

**Staleness detection (requires Phase 1 data):**
- Parse `usage.jsonl` retrieval events for each file
- "Stale" = never appears in a retrieval event within `staleness.windowDays` (default: 180)
- "Noisy" = appears in retrieval events but average eval score < `staleness.noiseThreshold` (default: 0.3) over at least `staleness.minEvals` evaluations (default: 10)

**Config for staleness thresholds:**

```jsonc
{
  "config": {
    "usageEvaluation": {
      // ... existing ...
      "staleness": {
        "windowDays": 180,
        "noiseThreshold": 0.3,
        "minEvals": 10
      }
    }
  }
}
```

**Output format:**

```
Contextus Health Report
═══════════════════════

✓ Daemon running (PID 42891, uptime 4h12m)
✓ Model loaded (nomic-embed-text via transformers.js)
✓ Corpus: 87 files, 428 chunks
✓ Config consistent (nomic-ai/nomic-embed-text-v1.5)
✗ 1 linked project missing: /old/path/removed-project
⚠ Usage eval: 23 jobs processed, queue empty
✗ 3 duplicate contexts detected
✗ 8 stale patterns (not retrieved in 6mo)
⚠ 2 noisy patterns (avg score < 0.3)

Recommended Actions
───────────────────
1. Remove dead link:
   → contextus link --remove /old/path/removed-project

2. Merge duplicates:
   → /context-merge decisions/deploy-checklist.md reference/deploy-steps.md

3. Review stale patterns:
   → /context-stats --filter stale

4. Review noisy patterns:
   → /context-review --filter noisy
```

---

## Phase 3: Curation Workflows

Skills that act on Phase 2 insights.

### `/context-promote <file>`

**Aliases:** `/ctx-promote <file>`

**Trigger:** Manual invocation or suggested by `/context-review`

**Targets:**
1. `CLAUDE.md` — for patterns that should always be loaded (critical > 70% of evals)
2. `.claude/memory/` — for patterns that are important cross-session but not always-on

**Behavior:**
1. Read the context file (validate it exists, has frontmatter)
2. Show the user: filename, description, usage stats (if available)
3. Ask target: CLAUDE.md or .claude/memory/
4. If CLAUDE.md: append under `## Contextus-Promoted Patterns` (create section if absent)
5. If memory: create memory file with converted frontmatter
6. Stage changes to git (don't commit)
7. Output: what was promoted, where, next steps ("review with `git diff`, commit when ready")

**The original file stays.** Promotion is copy-up, not move. Rationale: the context file still serves users who don't have the promoted pattern loaded (different projects linking this corpus). And removal is a separate, explicit action.

### `/context-archive <file>` or `--stale`

**Aliases:** `/ctx-archive <file>`

**Archive location:** `.claude/context/.archive/` (gitignored by convention, but not enforced)

**Behavior:**
1. Move the file from its category dir to `.archive/`
2. Update LanceDB: mark the row's source as archived (or delete + re-add at low priority)
3. Log the archival to usage.jsonl as a `type: "archive"` event
4. Stage the move

**Flags:**
- `<file>` — archive a specific file
- `--stale` — archive all files not retrieved in `staleness.windowDays`
- `--unused` — archive all files with avg score < `staleness.noiseThreshold` (requires `minEvals` data)
- `--dry-run` — show what would be archived without acting

**Archived files ARE still retrievable** (the LanceDB rows persist), but at heavily downranked priority. Implementation: add an `archived: boolean` column to LanceDB, and in `processSearchResults()`, apply a 0.5x score multiplier to archived rows. This makes them retrievable in a pinch but never beat active patterns.

**Alternative (simpler):** Just delete the LanceDB rows on archive. The file is preserved in `.archive/` and can be re-embedded if un-archived. This avoids the complexity of an `archived` column. **Recommended: delete rows on archive.** Simplicity wins.

### `/context-merge <file1> <file2>`

**Aliases:** `/ctx-merge <file1> <file2>`

**Behavior:**
1. Read both files
2. Call the eval model (Haiku) with a merge prompt:

```
You are merging two overlapping context patterns into one.

File 1 ({file1}):
{content1}

File 2 ({file2}):
{content2}

Write a single merged context file that:
- Preserves all unique information from both
- Eliminates redundancy
- Uses the frontmatter format: name, description, metadata.type, metadata.tags
- Keeps the body concise (under 500 words)

Output ONLY the merged file content (frontmatter + body), nothing else.
```

3. Present the merged content to the user for review/edit
4. On approval:
   - Write the merged file (using the first file's location by default, or `--output` path)
   - Move the second file to `.archive/`
   - Delete LanceDB rows for the second file
   - Re-embed the merged file
   - Stage all changes

**Merge prompt details:**
- Input: ~800 tokens (two context files)
- Output: ~300 tokens (merged file)
- Cost: ~$0.0004 per merge
- Provider: same as `usageEvaluation.provider`

### `/tag-context` Enhancement

The existing `/tag-context` skill (scripts/tag-context.ts) gets a new `--suggest` mode:

```bash
/tag-context --suggest
```

**Behavior:**
1. Read usage-ratings.jsonl
2. Find patterns frequently co-retrieved (appear in same eval batch 5+ times)
3. Suggest shared tags for co-occurring patterns
4. Find patterns always rated `unused` — suggest `deprecated` tag
5. Present suggestions; user approves/rejects each

This is low-priority within Phase 3 — the value is incremental.

---

## File Layout (new files)

```
daemon/
  eval-loop.ts                  # NEW: setInterval drain loop

lib/
  calibration/
    calibration-state.ts        # MODIFY: add 'continuous' mode
    eval-worker-core.ts         # MODIFY: write per-project usage-ratings.jsonl

scripts/
  stop-evaluation.js            # MODIFY: always-enqueue when usageEvaluation.enabled
  cli/
    context-stats.ts            # NEW: aggregation + display
    context-doctor.ts           # NEW: health checks

skills/
  context-stats/SKILL.md        # NEW: aggregation + display
  ctx-stats/SKILL.md            # NEW: alias
  context-review/SKILL.md       # NEW: interactive promotion
  ctx-review/SKILL.md           # NEW: alias
  context-doctor/SKILL.md       # MODIFY: add usage-driven checks (already exists)
  context-promote/SKILL.md      # NEW: promotion workflow
  ctx-promote/SKILL.md          # NEW: alias
  context-archive/SKILL.md      # NEW: archival workflow
  ctx-archive/SKILL.md          # NEW: alias
  context-merge/SKILL.md        # NEW: duplicate merge
  ctx-merge/SKILL.md            # NEW: alias

~/.contextus/
  data/<projectId>/
    usage-ratings.jsonl          # NEW: per-project eval ratings
  logs/
    usage.jsonl                  # EXISTING: add usage_signal + calibration_eval
```

---

## Migration & Backward Compatibility

1. **Config:** `usageEvaluation` is a new top-level config key. If absent, defaults apply (enabled, continuous, bedrock haiku, 1.0 sampling). No existing config breaks.

2. **Calibration state:** Adding `mode: 'continuous'` field. Existing state files missing this field get the default via spread: `{ ...defaults(), ...parsed }`. Existing campaigns continue to work.

3. **Stop hook:** The existing hook already enqueues during campaigns. The change is: also enqueue when `usageEvaluation.enabled` (which defaults true). Net effect: first daemon restart after upgrade starts collecting data.

4. **Log files:** `usage-ratings.jsonl` is new (per-project). Doesn't conflict with existing `usage.jsonl` (global). Both can be read independently.

5. **LanceDB:** No schema changes. Archive (Phase 3) deletes rows rather than adding columns.

---

## Implementation Order

### Phase 1 (one session, ~2-3 hours)

1. Add `UsageEvaluationConfig` to `lib/config.ts` + merge logic
2. Add `mode: 'continuous'` to `CalibrationState` + update `recordSample()` to respect it
3. Create `daemon/eval-loop.ts` (poll + drain)
4. Wire eval loop into `daemon/server.ts` (start after listen, stop on signal)
5. Modify `stop-evaluation.js`: add `usageEvalEnabled()` check, always-enqueue gate
6. Add per-project `usage-ratings.jsonl` write in `processJob()`
7. Add `usageEvaluation` defaults to DEFAULTS in config.ts
8. Add `usageEvaluation` to `plugin.jsonc`
9. Test: start daemon, send a query, verify eval fires and logs appear

### Phase 2 (separate session, ~3-4 hours)

1. `scripts/cli/context-stats.ts` — aggregation over usage-ratings.jsonl + usage.jsonl
2. `skills/context-stats/SKILL.md` — skill wrapper
3. `skills/context-review/SKILL.md` — interactive promotion logic
4. `scripts/cli/context-doctor.ts` — health checks (non-usage checks first, then staleness)
5. `skills/context-doctor/SKILL.md` — skill wrapper

### Phase 3 (separate session, ~2-3 hours)

1. `skills/promote-context/SKILL.md` — CLAUDE.md + memory promotion
2. `skills/archive-context/SKILL.md` — move + LanceDB cleanup
3. `skills/merge-context/SKILL.md` — Haiku-assisted merge
4. `/tag-context --suggest` enhancement

---

## Open Questions (deferred to user)

1. **Should the original context file be removed on promotion to CLAUDE.md?** This design says no (copy-up, not move). The user may prefer move-up to reduce corpus noise. Decision point: after Phase 2 data shows whether promoted patterns cause duplicate-injection issues.

2. **Archive directory: gitignored or not?** If gitignored, archives are local-only (can't be restored from git). If tracked, they're recoverable but add noise to the repo. Recommendation: tracked but excluded from embedding via a `.contextusignore` pattern.

3. **Eval model upgrade path:** If qwen2.5:32b proves reliable locally, should `usageEvaluation.provider` default to `ollama` with the larger model? Lower cost ($0) but higher latency (~2-5s vs ~500ms for Haiku). Depends on how the new model performs.

4. **Cross-project aggregation:** Should `/context-stats` show stats across all projects, or only the current one? Phase 2 implementation: current project only. Cross-project requires scanning all `data/*/usage-ratings.jsonl` files.

---

## Success Criteria

- [ ] Phase 1: After upgrade, `usage-ratings.jsonl` accumulates entries on every injected query (no user action needed)
- [ ] Phase 1: Eval failures log warnings but never block prompts or queries
- [ ] Phase 1: `samplingRate: 0.0` disables eval completely (zero LLM calls)
- [ ] Phase 2: `/context-stats` shows retrieval + usage data within 30 seconds of Phase 1 data existing
- [ ] Phase 2: `/context-doctor` identifies stale/duplicate patterns with actionable fixes
- [ ] Phase 3: `/promote-context` writes valid CLAUDE.md/memory entries that Claude loads correctly
- [ ] Phase 3: `/archive-context --stale` moves files + removes from LanceDB without data loss
