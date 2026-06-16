# Web Console / Visualization Interface Exploration

**Status**: Exploring for v3  
**Context**: User forgets which APIs/commands exist for testing; claude-mem has basic interface; rich visualization could help understand retrieval quality  
**Date**: 2026-06-15

> **⬇️ See "Reviewer notes (2026-06-15)" at the bottom before acting on this doc** —
> it reorders the progression, flags a missing-CLI dependency, scrubs stale `0.7`
> threshold / file-path references, and elevates the user's actual want: a
> **human-readable running activity log** (new Option 6), not charts.

## The Core Question

Should contextus v3 include an active web console for viewing configuration, statistics, calibration results, and live retrieval patterns?

## Motivation

**Current pain points:**
- CLI output for calibration results is hard to scan (100+ eval records as text)
- No way to spot trends or outliers at a glance
- Similarity score distributions need visualization, not tables
- Forget which commands/APIs to use for testing
- Hard to compare before/after when tuning thresholds

**What works well visually:**
- Similarity score distributions (histogram showing where 0.7 threshold sits)
- Calibration trends over time (scores improving as corpus matures?)
- Per-category quality breakdown (which categories are working?)
- Live retrieval log (what just got injected for this prompt?)
- Embedding space visualization (cluster view of context corpus)
- Token budget utilization heatmap
- Pattern usage frequency (which contexts actually land?)

**Inspiration:**
- User built vector-inspector previously (embedding visualization tool)
- claude-mem has basic interface but easy to forget APIs

## Options Analysis

### Option 1: Enhanced CLI Output

**What it is:**
- Better formatting for existing commands
- Add `--json` flags for machine-readable output
- Table/tree views for structured data

**Pros:**
- No new complexity
- Works over SSH
- File-based, scriptable

**Cons:**
- Still text-based, limited visualization
- Hard to show trends/patterns
- Doesn't solve "forgetting which commands exist" problem

**Effort:** Low  
**Value:** Medium

### Option 2: TUI (Terminal UI)

**What it is:**
- Rich terminal interface like `htop`, `lazygit`, `k9s`
- Libraries: `blessed`, `ink` (React for terminal), `tui-rs`
- Live updates, interactive navigation

**Features:**
- Dashboard view with live stats
- Scrollable logs panel
- Basic ASCII charts/sparklines
- Keyboard shortcuts for navigation

**Pros:**
- Still CLI-native, no browser required
- Can show live updates
- More visual than plain text
- Single binary, no web stack

**Cons:**
- Limited visualization compared to web
- Terminal compatibility issues
- Not as feature-rich as web

**Effort:** Medium  
**Value:** High for live monitoring

### Option 3: Static Dashboard Generation

**What it is:**
- `/context-dashboard` writes HTML to `.contextus/dashboard.html`
- Self-contained HTML with embedded JS (Chart.js, D3.js)
- Open in browser when needed
- Regenerate after calibration runs

**Features:**
- Calibration results visualization
- Similarity score histograms
- Category performance breakdown
- Pattern usage frequency charts
- Retrieval log explorer

**Pros:**
- No live server needed
- Maximum portability (just a file)
- Can use full web visualization libraries
- Zero runtime cost
- Aligns with "file-based everything"

**Cons:**
- Not live/real-time
- Manual refresh required
- No interactive filtering (unless client-side only)

**Effort:** Medium  
**Value:** High for analysis

### Option 4: Web Console (Live Server)

**What it is:**
- Web server running alongside daemon
- Real-time updates via WebSocket
- Full SPA with React/Vue/Svelte
- Interactive charts, filtering, drilling down

**Features:**
- Live retrieval log (streaming)
- Real-time calibration progress
- Interactive embedding space visualization
- Configuration editor (live preview)
- Pattern search and filtering
- A/B comparison for threshold tuning

**Pros:**
- Best UX, most powerful visualization
- Real-time monitoring
- Interactive exploration
- Can share URL with others

**Cons:**
- Most complexity (frontend build, server, ports)
- Another daemon/process to manage
- Security concerns (auth, CORS)
- Conflicts with "file-based everything"
- More failure modes

**Effort:** High  
**Value:** Very High for active development

### Option 5: JSON Export + External Tools

**What it is:**
- Commands export metrics as JSON/CSV
- Use existing viz tools (Observable, Jupyter, etc)

**Pros:**
- Lightest weight
- Most flexible
- No maintenance burden

**Cons:**
- Requires external tools
- Manual workflow
- No standardized experience

**Effort:** Very Low  
**Value:** Low (passes the buck)

### Option 6: Human-Readable Running Activity Log (`contextus watch`) ⭐

**The thing the user actually asked for (2026-06-15):** *"some kind of running log
that tells me what's happening instead of tailing json and CURLing endpoints."*

**What it is:**
- A follow-mode command — `contextus watch` (think `tail -f`, but pretty) — that
  streams daemon activity as **legible one-liners**, not raw JSONL:
  ```
  18:21:41  ✓ daemon warm        (ollama / nomic-embed-text)
  18:22:03  → query  "how should I handle logging here?"
  18:22:03    ↳ inject  decision-use-logger-helper.md (0.62) · gotcha-no-console-log.md (0.51)
  18:22:09  → query  "what's the retry policy?"
  18:22:09    ✗ no inject  (top 0.38 < floor 0.45)
  18:22:40  ⟳ reconcile demo  (+1 changed)  ·  ⚠ 1 quarantined: patterns/bad-type.md
  ```
- Reads the same dual-format daemon log we already write (the human half already
  exists — see LOGGING.md); `watch` is a formatter + follower over it. **No new
  server, no second daemon, no browser.** It's the file-based principle, made
  watchable.

**Why this is the sleeper pick:**
- It targets the *real* pain (line 4: "forgets which APIs/commands exist", and the
  daily reality of `tail -f …jsonl | jq` + `curl /health`). The web-console options
  solve a visualization problem the user didn't lead with.
- It collapses the three things you currently juggle — "is the daemon up?", "did this
  prompt inject?", "is reconcile healthy?" — into one always-on stream.
- The "highlight what Claude actually used" idea (from the v3 sketch) degrades
  gracefully here: once the Stop-hook eval lands, `watch` can append a `used ✓/✗`
  marker per injected file without any UI.

**Pros:**
- Lowest-cost thing that actually fixes the stated pain. CLI-native, works over SSH.
- Zero new runtime surface — it's a read-only follower of an existing log.
- Honest: it shows real retrieval/floor/quarantine events, the same ground truth
  `/context-doctor` reads.

**Cons:**
- Still linear/text — no trend analysis or distributions (that's what the static
  dashboard is for).
- Needs the daemon log's human format to be stable + complete (audit LOGGING.md first).

**Effort:** Low  
**Value:** Very High (directly solves the user's stated want)

## Recommended Progression

**v2: Enhanced CLI**
- Better formatting for existing commands
- Add `--json` exports
- Table views for structured data
- **Goal:** Make current interface less painful

**v2.5: Static Dashboard**
- `/context-dashboard` generates HTML file
- Visualization of calibration results
- Self-contained, no server needed
- **Goal:** Validate if visualization solves 80% of the problem

**v3: Optional Web Console**
- Behind flag: `contextus serve --web`
- Don't auto-start, opt-in only
- Focus on live monitoring + interactive exploration
- **Goal:** Full-featured viz for power users

## API Surface Area for Testing

### Current/Planned Commands

```bash
# Status and Health
/context-status               # System health dashboard
contextus status --json       # Machine-readable status

# Calibration
/context-calibrate --start    # Begin quality evaluation (100 samples)
/context-calibrate --report   # View results (text)
/context-calibrate --report --json  # Export results
contextus calibrate status    # Check calibration progress

# Troubleshooting
/context-doctor               # Diagnose issues
contextus doctor --verbose    # Detailed diagnostics

# Configuration
contextus config show         # Show current config
contextus config set <key> <value>  # Update config
contextus config reset        # Reset to defaults

# Corpus Management
contextus corpus list         # List all patterns
contextus corpus stats        # Corpus statistics
contextus corpus search <query>  # Search patterns

# Daemon Control
contextus daemon start        # Manual start
contextus daemon stop         # Stop daemon
contextus daemon restart      # Restart
contextus daemon logs         # View logs

# New: Dashboard/Visualization
contextus dashboard           # Generate static HTML dashboard
contextus dashboard --open    # Generate and open in browser
contextus serve --web         # Start web console (v3)
```

### Programmatic API (for testing/integration)

```javascript
// HTTP API (if web console exists)
GET  /api/status              // System health
GET  /api/calibration/latest  // Latest calibration run
GET  /api/calibration/history // Historical runs
GET  /api/corpus/stats        // Corpus statistics
GET  /api/retrieval/log       // Recent retrievals
GET  /api/config              // Current configuration
POST /api/config              // Update configuration
GET  /api/embeddings          // Embedding space data (for viz)

// WebSocket (live updates)
WS   /api/live                // Stream: retrieval events, calibration progress
```

### File-Based API (always available)

```bash
# Session State
~/.contextus/.session-state.json

# Calibration Results
~/.contextus/data/<project-hash>/calibration/latest.json
~/.contextus/data/<project-hash>/calibration/history/*.json

# Retrieval Logs
~/.contextus/data/<project-hash>/logs/retrieval-YYYYMMDD.jsonl

# Analytics Logs
~/.contextus/data/<project-hash>/logs/analytics-YYYYMMDD.jsonl

# Corpus Metadata
~/.contextus/data/<project-hash>/corpus-metadata.json
```

## Testing Quick Reference

**Minimal test workflow:**

```bash
# 1. Check daemon is running
contextus status

# 2. View current configuration
contextus config show

# 3. Trigger retrieval (via Claude Code)
# Just send a message, watch ~/.contextus/data/<project>/logs/retrieval-*.jsonl

# 4. Check what was injected
tail -f ~/.contextus/data/<project>/logs/retrieval-$(date +%Y%m%d).jsonl | jq

# 5. Run calibration
/context-calibrate --start

# 6. View results
/context-calibrate --report
# OR
cat ~/.contextus/data/<project>/calibration/latest.json | jq
```

**Common debugging commands:**

```bash
# Is daemon running?
ps aux | grep contextus-daemon

# Check logs
tail -f ~/.contextus/logs/daemon.log

# Validate embeddings
contextus corpus stats

# Reset session state
rm ~/.contextus/.session-state.json
```

## Web Console Feature Sketch (v3)

If we build it, here's what it should include:

### Dashboard View
- System health indicators (daemon status, embedding model loaded, cache hit rate)
- Real-time injection counter (last hour/day)
- Calibration score trend (line chart, last 7 days)
- Token budget utilization gauge

### Retrieval Log (Live)
- Streaming table: timestamp, prompt preview, patterns injected, similarity scores
- Filter by category, date range
- Click to expand full pattern content
- Highlight which patterns Claude actually referenced (from thinking block)

### Calibration View
- Historical run comparison (side-by-side score distributions)
- Per-category quality breakdown (radar chart)
- Individual evaluation drill-down (see prompt, patterns, rating, reasoning)
- Threshold tuning sandbox (adjust, see impact on precision/recall)

### Corpus Explorer
- Search patterns by content/category
- Embedding space visualization (2D/3D projection via UMAP)
- Cluster view (which patterns are semantically similar?)
- Usage heatmap (which patterns land most often?)

### Configuration Editor
- Live config editing with validation
- Preview mode (see what would change)
- Rollback to previous configs
- Per-project overrides

### Performance Metrics
- Retrieval latency histogram
- Embedding cache statistics
- Token savings over time (efficiency metric, not quality)
- Daemon resource usage (CPU, memory)

## Open Questions

**Philosophy:**
- Does a web console conflict with "file-based everything" principle?
- Is the complexity justified, or does static dashboard solve 80%?

**UX:**
- Would you use it constantly, or only when troubleshooting?
- Is live monitoring critical, or post-mortem analysis sufficient?

**Security:**
- Localhost only, or expose to network?
- Authentication needed? (probably not for localhost)

**Integration:**
- Should Claude Code have a `/context-console` command that opens it?
- Or just `contextus serve --web` from terminal?

## Decision Framework

**Start with static dashboard if:**
- Primary use case is analyzing calibration results
- Checking in weekly, not constantly monitoring
- Want to preserve "file-based everything" philosophy
- Complexity vs value tradeoff matters

**Build web console if:**
- Need live monitoring during active development
- Visualization is critical to understanding retrieval quality
- User excitement justifies complexity
- POC shows it's transformative, not just nice-to-have

**Suggested path:** Implement static dashboard in v2.5, measure how often you use it. If you find yourself wishing it was live, build the web console. If static is sufficient, invest effort elsewhere.

## Reviewer notes (2026-06-15)

Senior read after the Docs & DX milestone. The doc's bones are right (CLI → static →
optional live, gated on "do you wish it were live") and the restraint is good. Four
corrections before this hardens:

**1. The real motivation is discoverability, not visualization.** Line 4 buries the
lede: *"forgets which APIs/commands exist."* That's a DX problem, and a web console is
an expensive fix for it. The cheapest high-value items here need no browser at all:
`--json` on the engines + a one-screen command reference + **Option 6's `contextus
watch`**. Don't let the fun of charts hide the boring win.

**2. This doc invents a CLI that doesn't exist yet.** The entire "API Surface Area"
section assumes a unified `contextus <subcommand>` binary (`contextus status`,
`config show`, `daemon logs`, `corpus stats`). **We have none of that.** Today it's
`/skill` commands + `tsx`-by-path engines + raw `curl 127.0.0.1:37800/health`. So this
is quietly two projects: (a) a unified CLI / stable JSON+HTTP contract, and (b) a
console consuming it. The console is *downstream* of a surface that isn't built — and
that contract is the actually-valuable artifact (every later option consumes it). Make
the dependency explicit.

**3. Stale numbers + unverified paths.** Scrub before building anything off this:
- The recurring **`0.7` threshold** (motivation, histogram sketch) is dead. The gate is
  per-project `injectionFloor` (~0.45/0.40), not one global threshold — any histogram
  draws *the project's* floor line, and it differs per project.
- The `~/.contextus/data/<project-hash>/logs/retrieval-*.jsonl` / `analytics-*.jsonl` /
  `corpus-metadata.json` paths are aspirational — they may not match the real on-disk
  layout. Confirmed real this session: `~/.contextus/logs/daemon.log` (dual-format) and
  `~/.contextus/data/<project>/`. **Verify everything against `docs/dev/LOGGING.md`**
  rather than trusting the paths inline here.

**4. The file-based tension has an answer.** "Does a console conflict with file-based
everything?" — yes for a *live server* (Option 4: second long-lived daemon, ports,
CORS, auth, frontend build), no for a *static dashboard* (Option 3: reads files, emits
a file) or `watch` (Option 6: read-only follower). The real v2.5/v3 boundary isn't
effort — it's **willingness to run a second process**. Static + watch are free of that
tax; the web console has to *earn* it by being transformative, not nice-to-have.

**Reordered progression (supersedes "Recommended Progression" above):**
- **v2:** `--json` on every engine + a command reference (`/context-help`-ish) +
  **`contextus watch`** (Option 6 — the user's stated want; lowest cost, kills the
  daily `tail|jq` + `curl` pain). First audit LOGGING.md so `watch` has a stable,
  complete human-format stream to follow.
- **v2.5:** static `/context-dashboard` HTML — whose *real* deliverable is the **stable
  JSON schema** it reads. That schema is the API everything else depends on.
- **v3:** web console only if you catch yourself wishing the static one were live. Bar:
  transformative. Cost: a second daemon.

## Related Files

- `docs/dev/DESIGN.md` — Core architecture
- `docs/dev/DESIGN_QUESTIONS.md` — Implementation decisions
- `docs/dev/LOGGING.md` — Log schema (powers visualization)
- `.claude/memory/MEMORY.md` — Design decision records

## Next Steps

1. **Immediate (v2):** Improve CLI output, add `--json` flags
2. **Near-term (v2.5):** Implement static dashboard, gather feedback
3. **Future (v3):** Decision point on web console based on static dashboard usage

**If building web console:**
- Spike a minimal POC (weekend project)
- Just retrieval log + basic stats
- Validate if it's transformative or marginal
- Decide before committing to full build
