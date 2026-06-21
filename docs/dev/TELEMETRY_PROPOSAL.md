---
name: telemetry-proposal
description: Proposal for opt-in telemetry to understand reach and adoption, with complete transparency requirements
metadata:
  type: decision
  status: proposal
  tags: [telemetry, privacy, analytics, adoption]
---

# Telemetry Proposal

**Status**: Proposal (not yet implemented)

**Current stance**: contextus explicitly has **zero telemetry** (documented in PRIVACY.md, slides, presentations as a privacy feature).

## Motivation

Understanding contextus reach and adoption is currently blind. Useful metrics:
- **Reach**: How many users/installs?
- **Adoption**: Which features are used? Which config patterns dominate?
- **Quality signals**: Are people seeing value (usage rates, floor calibrations)?
- **Error patterns**: What breaks in the wild?

This data informs roadmap prioritization and helps identify quality issues before users file issues.

## Proposal

**Opt-in telemetry** with complete transparency:

1. **Setup-time opt-in**: `/contextus-setup` asks during guided flow (default: NO, explicit yes required)
2. **Transparent data**: Document exactly what's collected, no hidden metrics
3. **User control**: Easy disable via config + re-prompt on major version upgrades
4. **Open backend**: Reuse vector-inspector telemetry backend (same infra, known patterns)
5. **Anonymized**: No PII, no content — just usage patterns and error types

## Metrics Categories

### 1. Reach & Install Metrics

**Goal**: Understand adoption and active user base

- **Install events**: version, platform (darwin/linux/win32), architecture, first-run timestamp
- **Active installs**: daily/weekly active users (anonymized session ID)
- **Version distribution**: which versions are in use, upgrade velocity
- **Uninstall signals**: daemon last-seen timestamp gaps (infer abandonment)

**Value**: Prioritize platform-specific work, understand update adoption, measure growth.

### 2. Feature Usage

**Goal**: Identify which features provide value vs which are ignored

- **Skills invoked**: which `/ctx-*` skills are used, frequency distribution
- **Retrieval stats**: queries per session, injection rate (% above floor), avg results returned
- **Expansion mode usage**: adaptive/always/off distribution
- **Expansion provider usage**: ollama/bedrock/anthropic/custom distribution, fallback frequency (primary → fallback)
- **Calibration runs**: floor calibration frequency, recommended vs applied floor values
- **Linked projects**: how many users use linked projects, avg links per workspace
- **Config overrides**: which config fields are customized vs defaults

**Value**: Guides feature investment (double down on high-usage, deprecate unused), surfaces friction (why isn't X used?).

### 3. Quality Signals

**Goal**: Measure whether contextus delivers value

- **Usage rates**: context marked "used" in provenance footer (% of injections)
- **Score distributions**: bestScore histograms (are people getting relevant results?)
- **Floor calibration outcomes**: recommended floor values (surface quality issues if recommendations drift high)
- **Injection frequency**: % of prompts that receive context (too low = corpus gaps, too high = noisy retrieval)
- **Pattern density**: avg context files per project, tags-per-file distribution
- **Retrieval latency**: p50/p95/p99 query times (daemon performance)

**Value**: Proactive quality monitoring — spot retrieval degradation, identify corpus best practices, catch performance regressions.

### 4. Error & Degradation Patterns

**Goal**: Find bugs and edge cases before users report them

- **Daemon crashes**: exception types (no stack traces), frequency, version correlation
- **Degradation events**: ollama timeouts, bedrock failures, LanceDB errors, watcher failures
- **Recovery patterns**: auto-recovery success rate, graceful degradation usage
- **Hook failures**: which hooks fail, at what rate (SessionStart/UserPromptSubmit/Stop)
- **Missing dependencies**: ollama not installed, bedrock credentials missing, disk space issues

**Value**: Prioritize stability work, catch platform-specific bugs, understand real-world failure modes.

### 5. Configuration Patterns

**Goal**: Understand how people configure contextus in the wild

- **Embedding provider**: ollama vs transformers.js distribution (which embedding path is popular?)
- **Expansion provider**: ollama/bedrock/anthropic/custom distribution (primary and fallback)
- **Expansion mode**: adaptive/always/off (correlate with usage rates for quality signal)
- **Injection floor**: custom values vs default 0.45 (are people tuning?)
- **Reranking**: enabled/disabled distribution (does it improve quality?)
- **Watcher usage**: file-watch enabled/disabled (platform correlation)
- **Context corpus size**: percentile distribution (10/50/90th percentile file counts)

**Value**: Informs default recommendations, surfaces config patterns that correlate with quality.

### 6. Model Usage & Performance

**Goal**: Understand which models benefit most from contextus, optimize for actual usage

- **Model distribution**: Opus/Sonnet/Haiku/Fable usage split (which tier uses contextus?)
- **Model version tracking**: Specific versions (opus-4.8, sonnet-4.6, etc.) — informs compatibility testing
- **Usage rate by model**: Does Opus use context more effectively than Haiku? (quality correlation)
- **Injection rate by model**: Do smaller models get injected more (lower floor tolerance) or less (higher bars)?
- **Model tier trends**: Are users moving up/down tiers? (cost vs quality tradeoffs)
- **Fast mode usage**: How often is fast mode enabled when context is injected?

**How to collect**:
- Claude Code session metadata (model, version, fast mode) available via environment or session state
- Correlate retrieval events with active model at injection time

**Value**: 
- Optimize injection strategy per model tier (Opus: quality-focused, Haiku: efficiency-focused)
- Prioritize testing on most-used models
- Understand cost/quality tradeoffs users make
- Surface if certain models don't benefit from contextus (deprioritize optimization)

### 7. Ecosystem Integration

**Goal**: Understand how contextus fits into workflows

- **Claude Code version**: which harness versions are used (compatibility planning)
- **Session patterns**: sessions per day, avg session length, prompts per session
- **Corpus growth**: new context files added per week (organic corpus building)
- **Setup choices**: Quick vs Power User setup preference, tune-after-setup usage
- **Multi-project usage**: users with >1 project indexed (workspace adoption)

**Value**: Design features for actual usage patterns, not assumptions.

## What Would Never Be Collected

**Hard boundaries** (violating these invalidates the entire proposal):

- ❌ Context file content or excerpts
- ❌ Prompt text or Claude responses
- ❌ Project names, paths, or directory structures
- ❌ API credentials or tokens
- ❌ User identity (email, username, machine name)
- ❌ IP addresses (backend must not log them)
- ❌ Git history or commit messages
- ❌ File paths from error stack traces
- ❌ Any content from `.claude/context/` files

**Only collected**: Anonymous session IDs (random UUIDs), aggregate counts, timing distributions, categorical choices.

## Transparency Requirements

For this to move forward:

1. **PRIVACY.md update** — full disclosure of what's collected, opt-in nature, data retention
2. **Setup wizard disclosure** — explain metrics before asking, link to privacy doc
3. **Source inspection** — telemetry client code must be obviously auditable (single module, clear events)
4. **Dashboard** (optional) — public aggregate stats showing adoption/usage trends
5. **Disable verification** — `--no-telemetry` flag or config override must be trivially checkable

## Implementation Notes

- **Backend**: Reuse vector-inspector telemetry backend (already deployed, user-controlled)
- **Client**: Lightweight fire-and-forget (no retries, no blocking, graceful failure)
- **Batching**: Buffer events locally, batch-send on daemon shutdown or daily
- **Config key**: `telemetry.enabled: false` (default) in config schema

## Tradeoffs

**Pros**:
- Data-driven roadmap decisions
- Identify quality issues proactively
- Understand real-world usage patterns
- Measure impact of changes

**Cons**:
- Shifts "zero telemetry" marketing message
- Requires backend maintenance
- Risk of scope creep ("just one more metric...")
- User trust erosion if transparency slips

## Next Steps (if pursuing)

1. Add to V2_ROADMAP under "Future Considerations"
2. Design telemetry event schema (what/when/format)
3. Implement backend endpoint (or extend vector-inspector backend)
4. Add setup wizard opt-in flow
5. Update PRIVACY.md with full disclosure
6. Implement client (fire-and-forget, no blocking)
7. Add transparency verification (config check, easy audit)

## Why Not Now

v1.x focus is core retrieval quality and adoption among early users. Telemetry adds:
- Backend maintenance burden
- Privacy policy complexity
- Potential trust concerns during early adoption phase

Better to establish value first, add instrumentation when the product is proven.

## Potential High-Value Insights

These metrics combinations could inform product decisions:

### Quality Correlations
- **Floor vs usage rate**: Do higher floors correlate with better usage rates? (inform default recommendations)
- **Expansion mode vs quality**: Does expansion improve usage rates enough to justify latency?
- **Corpus size vs quality**: Is there a "sweet spot" size, or does more always help?
- **Reranking impact**: Usage rate delta with/without reranking (justify the feature)
- **Model tier vs usage rate**: Does Opus use context more effectively than Haiku? (optimize per-tier strategies)
- **Model tier vs injection rate**: Are smaller models more/less selective? (floor tuning by tier)

### Adoption Patterns
- **Setup → first value**: Time from install to first "context used" signal (onboarding friction)
- **Skill discovery**: Which skills are found organically vs never used? (documentation gaps)
- **Calibration adoption**: How many users run floor calibration? (is it discoverable?)
- **Linked projects**: What % adopt linked projects? (niche vs mainstream feature)

### Failure Modes
- **Silent failures**: Degradation events that don't surface to users (improve error visibility)
- **Platform issues**: Which platforms have higher error rates? (test coverage gaps)
- **Upgrade blockers**: Version-specific crash spikes (regression detection)
- **Config mistakes**: Common misconfigurations leading to degradation (better validation/docs)

### Roadmap Prioritization
- **Feature gaps**: Low injection rates + high query volume = corpus coverage problem
- **Performance bottlenecks**: Latency spikes correlated with corpus size = indexing optimization needed
- **Unused features**: Skills never invoked = deprecation candidates or doc problems
- **Power user patterns**: What do high-usage-rate users do differently? (best practices)

## Dev/Test Exclusion

**Problem**: Developer usage and test runs pollute production metrics, making every measurement unreliable.

**Solution**: Multi-layered detection and filtering

### 1. Environment Detection

Automatically mark events as non-production when:

```typescript
const environment = 
  process.env.CI ? "ci" :                          // GitHub Actions, CircleCI, etc.
  process.env.NODE_ENV === "test" ? "test" :       // unit/integration tests
  process.env.CONTEXTUS_DEV === "true" ? "dev" :   // explicit dev mode
  isKnownDeveloper() ? "dev" :                     // maintainer detection (see below)
  "production";
```

### 2. Maintainer Detection

Flag known maintainers automatically (opt-out from production metrics):

- **Git config check**: `git config user.email` matches known maintainer emails (hashed for privacy)
- **Dev mode file**: Presence of `~/.contextus/dev-mode` file (created during repo setup)
- **Session ID exclusion list**: Backend maintains hashed session IDs to filter (updated on request)

### 3. Test Mode Detection

Mark all events during test runs:

```typescript
// In test setup
process.env.CONTEXTUS_TELEMETRY_ENV = "test";

// In telemetry client
if (process.env.CONTEXTUS_TELEMETRY_ENV === "test") {
  // Either don't send, or send with environment: "test" tag for filtering
}
```

### 4. Filtering Strategy

**Option A**: Don't send non-production events at all (cleanest, but lose visibility into test coverage)

**Option B**: Send everything with `environment` tag, filter server-side (allows dev/test analysis separately)

**Recommendation**: Option B — separate dashboards for prod/dev/test, but collect all for troubleshooting.

### 5. Manual Override

Config-level override for edge cases:

```jsonc
{
  "telemetry": {
    "enabled": true,
    "environment": "production",  // or "dev" | "test" | "ci" (override detection)
    "exclude_maintainer": true    // maintainer can opt into being counted (for dogfooding metrics)
  }
}
```

## Event Schema Sketch

```typescript
// Base event structure
interface TelemetryEvent {
  event_type: string;          // "install" | "query" | "skill_invoked" | "degradation" | ...
  session_id: string;          // anonymous UUID (persisted per-machine)
  version: string;             // contextus version
  platform: string;            // "darwin" | "linux" | "win32"
  timestamp: number;           // epoch ms
  environment: string;         // "production" | "dev" | "test" | "ci"
}

// Example: Retrieval quality signal
interface RetrievalEvent extends TelemetryEvent {
  event_type: "retrieval";
  injection_floor: number;     // configured floor
  best_score: number;          // top result score
  results_count: number;       // how many results returned
  was_injected: boolean;       // did it pass floor?
  was_used: boolean | null;    // null if no footer parsed, true/false if parsed
  expansion_mode: string;      // "adaptive" | "always" | "off"
  expansion_fired: boolean;    // did expansion kick in?
  expansion_provider: string | null;  // "ollama" | "bedrock" | "anthropic" | null
  expansion_fallback: boolean; // true if fallback provider was used
  expansion_latency_ms: number | null;
  reranking_enabled: boolean;
  total_latency_ms: number;    // end-to-end query time
  // Model context
  model_tier: string | null;   // "opus" | "sonnet" | "haiku" | "fable" | null (parsed from model ID)
  model_version: string | null; // e.g., "claude-opus-4.8" (full model ID if available)
  fast_mode: boolean | null;   // true if fast mode enabled
}

// Example: Skill usage
interface SkillEvent extends TelemetryEvent {
  event_type: "skill_invoked";
  skill_name: string;          // "/ctx-status" | "/ctx-calibrate" | ...
  success: boolean;
}

// Example: Degradation
interface DegradationEvent extends TelemetryEvent {
  event_type: "degradation";
  component: string;           // "ollama" | "bedrock" | "anthropic" | "lancedb" | "watcher"
  error_type: string;          // exception class name
  recovered: boolean;          // did auto-recovery work?
}
```

## Backend Requirements

If using vector-inspector telemetry backend:

1. **Endpoint**: POST `/v1/telemetry/contextus` (namespaced to avoid collision)
2. **Auth**: None (public ingest, rate-limited by IP)
3. **Validation**: Schema check, reject malformed events
4. **Storage**: TimescaleDB or similar time-series store (cheap retention, fast aggregation)
5. **Retention**: 90 days raw events, aggregates forever
6. **Access**: Read-only dashboard for aggregate stats, no raw event access
7. **Privacy**: No IP logging, session IDs are UUIDs (not machine-identifiable)

## Open Questions for Discussion

1. **Granularity**: Per-query events vs daily aggregates? (tradeoff: insights vs privacy/bandwidth)
2. **Opt-out friction**: Should there be a `--no-telemetry` CLI flag in addition to config? (ease of audit)
3. **Public dashboard**: Show aggregate stats publicly (builds trust) or keep private?
4. **Retention policy**: How long to keep raw events? (90 days? 1 year? aggregates only?)
5. **Sampling**: Always send or sample high-volume events (e.g., 10% of queries)?
6. **Upgrade prompts**: Re-confirm opt-in on major versions or trust initial choice?
7. **Local inspection**: Should users be able to see buffered events before they're sent?
8. **Dev/test filtering**: Send all with `environment` tag (separate analysis) or don't send non-prod at all?
9. **Maintainer exclusion**: Automatically exclude detected maintainers from prod metrics, or require explicit opt-out?
10. **CI visibility**: Should CI runs be visible (catch test failures) or always excluded (noise)?

## Related

- PRIVACY.md — current "zero telemetry" documentation
- vector-inspector — telemetry backend reuse candidate
- docs/dev/EVALUATION.md — existing quality measurement (local-only)
- Usage signal tracking (Stop hook) — already captures usage data locally
