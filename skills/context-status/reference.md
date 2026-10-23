---
name: context-status
description: Health dashboard for contextus — corpus stats, daemon health, recent embeddings, injection coverage, calibration quality metrics. The go-to diagnostic when something feels off.
---

# Context Status

Quick impact dashboard — shows what contextus is doing for you.

## Output

```
Contextus Status

Version: v0.19.7

Knowledge Base:
  📁 Context patterns: 68 files
  📄 Documentation: 22 files  
  🔢 Vector entries: 142 chunks

Activity (last 30 days):
  📊 Injection rate: 73% of prompts received context
  ⚡ Avg retrieval: 156ms
  📈 Growth: +12 context patterns, +5 docs

Efficiency (last 30 days):
  💾 Compression: 69% (847k injected vs 2.7M full-file baseline)
  📉 Trend: -15% tokens/injection (getting leaner)

Recent:
  ✓ Last retrieval: 2 minutes ago (logger-helper.md)
  ✓ Last capture: 4 hours ago (wdio-workaround.md)
  ✓ Last rebuild: 2 days ago

Quality: Run /context-calibrate to measure retrieval effectiveness
Details: /context-status --details
Optimize: /context-calibrate
```

## Detailed Mode

```bash
/context-status --details
```

Includes technical metrics for power users:

```
Contextus Status (Detailed)

Version: v0.19.7

Knowledge Base:
  📁 Context patterns: 68 files
  📄 Documentation: 22 files  
  🔢 Vector entries: 142 chunks
  🗄️  Database: ~/.contextus/data/automation/ (4.2 MB)

Activity (last 30 days):
  📊 Injection rate: 73% of prompts received context
     ├─ Injected: 620 prompts
     ├─ Skipped (below floor): 228 prompts (27%)
     └─ Total: 848 prompts
  ⚡ Retrieval latency: 156ms (p50), 278ms (p95)
  🎯 Avg similarity: 0.79

Efficiency (last 30 days):
  💾 Compression: 69% (847k injected vs 2.7M full-file baseline)
  📉 Trend: -15% tokens/injection (getting leaner)
  📈 Growth: +12 context patterns, +5 docs

Quality:
  Last calibration: 67 days ago (2026-04-06)
  ⚠ Recommend re-calibration (target: every 3-6 months)
  Run: /context-calibrate --start

Embedding:
  Model: nomic-ai/nomic-embed-text-v1.5 (768 dim)
  Last rebuild: 2 days ago
  ⚠ 3 files stale (2.9%) → run /rebuild-embeddings

Configuration:
  topK: 5
  injectionFloor: 0.65
  similarityThreshold: 0.7
  dedupThreshold: 0.85
  captureMode: propose

Recent Errors:
  ✓ None (last 7 days)

Recent Activity:
  ✓ Last retrieval: 2 minutes ago (logger-helper.md)
  ✓ Last capture: 4 hours ago (wdio-workaround.md)
  ✓ Last rebuild: 2 days ago

Troubleshoot: /context-doctor
Measure quality: /context-calibrate
```

## What It Shows

### Version
Daemon's running code version (`data.version` from `/introspect`), compared against
this machine's data schema version (`~/.contextus/version.json`). They normally
match. A gap means an upgrade notice fired (session-start reported "updated to X")
but the breaking-change migration hasn't been run yet — surfaced here as
`run /contextus-upgrade` rather than silently showing a stale version.

### Knowledge Base
- **Context patterns**: Files in `.claude/context/`
- **Documentation**: Files in `docs/` (if enabled)
- **Vector entries**: Total chunks (after splitting long docs)

### Activity Metrics
- **Injection rate**: % of prompts that received context (rest skipped by injection floor)
- **Avg retrieval**: Typical query latency

### Efficiency Metrics
- **Compression**: Ratio of injected tokens vs full-file baseline (measures compression pipeline efficiency, not retrieval quality)
- **Trend**: Change in tokens/injection over time (negative = getting leaner)

### Growth Tracking
- New context patterns added (by mtime)
- New docs added (by mtime)

### Recent Activity
- Last successful retrieval (what pattern, when)
- Last capture (new pattern created, when)
- Last embedding rebuild

## Implementation

**Run this — there is exactly one command for this skill** (default view, `--details`, and `--cost` are all flags on the same script; see below for the exact invocation and where to run it from).

The script is a standalone CLI (`scripts/cli/status.ts`) that internally calls the daemon's `GET /introspect` endpoint and parses `~/.contextus/logs/usage.jsonl` — you never call `/introspect` yourself. It is documented below purely as background on what data backs each dashboard field; skip straight to **"Run the CLI"** further down if you just want the command.

### Where to run it from — this is the part that trips people up

`status.ts` resolves which project to report on like this:
- If you pass `--project <name-or-hash-or-path>`, it uses that (via the projects registry — works from any cwd).
- **Otherwise it hashes the shell's current `process.cwd()`** (`status.ts:320`) to get the projectId — so if the Bash tool's cwd is NOT the target project's root, you'll silently get the wrong project's dashboard (or an empty one), not an error.

So when checking status for a project other than the one you're currently working in (e.g. checking `automation` while your Bash cwd is still `claude-contextus`), you MUST do one of:
- `cd /path/to/target-project && npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/cli/status.ts" ...`, or
- pass `--project /path/to/target-project` (or `--project <registered-name>`) explicitly and skip the `cd`.

Do not try to compute or pass a project hash by hand — `--project` accepts a plain path or registered name and resolves the hash for you.

### 1. Live state — `GET /introspect` (Phase 5, called internally by the script)

The daemon's introspection endpoint is the source of truth for everything that
reflects the *current* configuration and corpus. The script queries it for the
resolved project, and if the daemon is unreachable, falls back to a "daemon down"
line (don't fabricate numbers). For reference, the equivalent manual call (you
should not need to run this yourself) is:

```bash
curl -s "http://127.0.0.1:37800/introspect?project=$(pwd)"
```

`/introspect`'s `project` param accepts a hash, a registered name, OR an absolute
path — the daemon resolves it server-side, so passing `$(pwd)` directly (no manual
hashing) works as long as the daemon's cwd for that call matches the target project.

Returns (live, not mocked):
```json
{
  "version": "0.1.0",
  "uptimeSeconds": 4231,
  "modelLoaded": true,
  "embedding": { "provider": "ollama", "model": "nomic-embed-text",
                 "dimensions": 768, "corpusProvider": "ollama", "corpusModel": "nomic-embed-text" },
  "packs": ["projectMemory", "projectDocs", "userMemory", "userDocs"],
  "corpus": { "chunks": 3, "byType": {"decision":1,"implementation":1,"reference":1},
              "withHits": 0, "totalHits": 0, "topHits": [] },
  "retrieval": { "topK": 5, "injectionFloor": 0.35, "similarityThreshold": 0.7, "maxTokens": 3000 },
  "rerankWeights": { "typeBoosts": {...}, "sourceWeights": {...} },
  "calibration": { "evaluateUsage": false, "sampleCount": 0, "targetSamples": 100 }
}
```

Use `corpus.chunks`/`byType` for the Knowledge Base section, `retrieval.*` for
Configuration, `corpus.topHits` for most-retrieved patterns, `calibration.*` for
the Quality line, and `embedding.*` for the Embedding section. **No hard-coded
config values** — they all come from here.

### 2. Historical activity — usage logs

For the 30-day Activity/Efficiency trends (injection rate, latency percentiles,
tokens), parse `~/.contextus/logs/usage.jsonl` (LOGGING.md schema) — retrieval,
no-inject, and `calibration_eval` events:
```json
{ "type": "retrieval", "timestamp": "...", "retrieved": ["logger-helper"],
  "tokens_injected": 542, "latency_ms": 163, "similarity_scores": [0.57] }
```
Injection rate = retrievals with `retrieved.length > 0` ÷ all retrieval events.
Quality (if calibrated) = mean `weighted_score` across `calibration_eval` events.

### 3. Filesystem scan

Count `.claude/context/` files + `docs/` by mtime for the Growth line.

## Cost Mode

```bash
/context-status --cost [--project <name>] [--days <N>]
```

Outputs the honest org defensibility report — absolute injection cost paired with value signal:

```
Token Cost Report (2026-05-18 → 2026-06-17)
Project: automation

Queries:
  Total:           848
  Injected:        620 (73.1%)
  Skipped (floor): 228

Injection Cost:
  Total tokens:    89,400
  Avg per query:   144 tokens
  Daily run rate:  ~2,980 tokens/day

Value Signal:
  Calibration evals:  45
  Weighted score:     72%
  Usage ratings:
    used: 32
    partially_used: 8
    not_used: 5

Bottom Line:
  89,400 tokens injected (~2,980/day) with strong (72% weighted usage score) value signal.
```

### Run the CLI

Covered in detail above ("Where to run it from") — the short version:

```bash
# From inside the target project's root (recommended — no flag needed):
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/cli/status.ts" > /tmp/status.txt 2>&1 && cat /tmp/status.txt

# From anywhere else — pass the target project explicitly:
npx tsx "${CLAUDE_PLUGIN_ROOT}/scripts/cli/status.ts" --project /path/to/target-project > /tmp/status.txt 2>&1 && cat /tmp/status.txt
```

`CLAUDE_PLUGIN_ROOT` is set by the harness when contextus is loaded (via `--plugin-dir` in development, or installed from marketplace) — it points to the plugin directory regardless of your Bash cwd, so it's safe to use even when checking a different project's status.

For cost analysis, add `--cost [--days <N>]` to either form above.

**Development workflow**: When working in the contextus source directory itself, use `pnpm exec tsx scripts/cli/status.ts [--project ...] [--cost ...]` instead (relative path, no `CLAUDE_PLUGIN_ROOT` needed).

**Why redirect to file**: Bash tool truncates long output with "...(N lines)". The redirect captures everything; cat bypasses the truncation.

The script reads `~/.contextus/logs/usage.jsonl` and computes:
- **Total injected tokens** = absolute cost of all injections in the period
- **Daily run rate** = total ÷ days (for budgeting)
- **Value signal** = mean weighted_score from calibration_eval events
- **Injection rate** = queries with ≥1 pattern ÷ total queries

Pass `--json` for machine-readable output.

## Design Notes

This is the **user-facing** dashboard. Non-technical, focuses on **value delivered**:
- "How much is this helping me?" (tokens saved, usage rate)
- "Is it growing?" (new patterns/docs)
- "Is it working?" (recent activity)
- "What does it cost?" (--cost: absolute injection tokens + value signal)

Technical tuning metrics (zero-hit patterns, staleness, threshold calibration) live in `/context-calibrate`.
