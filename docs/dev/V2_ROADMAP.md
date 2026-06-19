# V2 Roadmap

Post-v1 feature backlog and open design questions. Items listed roughly by dependency order.

**Status:** v1 shipped; dogfooding across multiple repos. This doc captures what's deliberately deferred and what's already landed.

> **Distribution / packaging is tracked separately** in [PACKAGING.md](PACKAGING.md)
> (a v1.1 milestone, not a v2 feature): making contextus GitHub-marketplace
> installable rather than `--plugin-dir`-only. Different axis from the feature work below.

---

## V2 Backlog

Shaped by the CAE, Categories, Self-Documentation, and Removal design docs. None of these block a trustworthy v1.

**Ordered by readiness, not just dependency** (2026-06-14, updated 2026-06-18). The dependency graph still
matters (it's the "Depends On" column), but for *sequencing a work session* the question
that matters more is: **can I act on this now, or does it need real dogfooding data first?**
Two tracks below. CAE is the keystone either way — most of Track A's later items hang off it.

### Shipped (landed on main)

| Item | PR | Date | Notes |
|------|-----|------|-------|
| **Multi-vector query expansion (adaptive)** | #2 | 2026-06-17 | Ollama qwen2.5:3b primary, Bedrock Haiku fallback. Adaptive trigger (fires when best_score < expansionThreshold). |
| **Provider-down alerting** | #3 | 2026-06-17 | `warmupError` on `/health`, actionable systemMessage on session-start. Auto-recovery with liveness probes. |
| **Token-cost reporting** | #4 | 2026-06-17 | `/context-status --cost` — absolute metrics (total injected, avg/query, daily run rate). Honest cost framing. |
| **Keyword fallback (provider down)** | #5 | 2026-06-17 | BM25-ish scan when embeddings unavailable. Conservative gate, tagged `(keyword fallback)`. |
| **Hybrid search (semantic + keyword RRF)** | #6 | 2026-06-17 | Always-on keyword fusion via RRF. |
| **Retrieval-miss proposals** | #7 | 2026-06-18 | Near-miss detection → awareness footer proposing new context capture. Evidence-driven. |
| **Scoring fix + adaptive hybrid** | #8 | 2026-06-18 | Fixed L2²→cosine formula (`1-d/2`), fixed RRF normalization. Hybrid mode: `always`→`adaptive` (keyword only fires when semantic < floor). Thresholds recalibrated to correct scale. |
| **v0.6 sprint** | #9 | 2026-06-19 | Pre-warm expansion model, fs.watch deletion detection (macOS), `/contextus-setup --tune`, usage signal tracking (`pnpm usage-rate`), interactive setup wizard (two-track), proactive capture footer, `--help` on CLI scripts. |
| **Query transformation** | — | — | Superseded by multi-vector expansion (PR #2). Boilerplate stripping remains a TODO. |

### Track A — buildable now (no usage data required)

Roughly in build order; CAE first because it unblocks the most.

| Item | Source | Depends On | Notes |
|------|--------|------------|-------|
| **CAE gate** — Haiku applicability sub-agent per candidate, scoring rubric (§4), hard overrides, conflict priority. Slots in as `… → floor → CAE → inject`. | CAE spec | v1 floor + rejection logging | The keystone — tag-gating, removal, and the relevance-gate all hang off it. (Its *cost model* is Track B.) |
| ~~**Deletion detection**~~ | ~~(discovered 2026-06-14)~~ | ~~Phase 6 auto-reconcile~~ | **SHIPPED** PR #9 — fs.watch live deletion (macOS/Windows only; Linux falls back to reconcile-on-start). See "Corpus Reconciliation" section below. |
| ~~**`/contextus-setup` skill**~~ | ~~user idea 2026-06-18~~ | ~~floor-calibration, config-write~~ | **SHIPPED** PR #9 — two-track wizard (Quick/Power User), `setup-detect.ts` state gathering, `--tune` calibration, provider detection, legacy migration offer, cross-project awareness. Remaining: transcript mining offer (Track B, gated on usage data). |
| **Per-category retrieval config** — Category Rule 4: each category declares injection trigger, weight, scope, merge/compete behavior. Re-ranker reads it. | Categories §3 (Rule 4) | re-ranker | Independent re-ranker work |
| **Multi-source incremental refresh** — v1's watch/reconcile path is `.claude/context/`-only; doc + user packs refresh only on a full `pnpm run embed`. v2: incrementally re-embed docs on change too (slower-changing, noisier). | Phase 6 multi-source | v1 multi-source ingest | The docs auto-refresh gap; deliberate v1 scope cut |
| **Smarter chunking** — v1 ships fixed header-split + token-fallback with collapse-to-file. v2: semantic/recursive chunking, per-source chunk sizing (docs ≠ context), chunk-level dedup, tuning `topK × fanout`. | Phase 6 chunking | v1 chunker | Chunking pulled into v1 (nomic 2048 cap); maturity is v2 |
| **Evidence-driven category taxonomy** (user Q 2026-06-15: "how do we know we covered enough categories?") — the 12 `KNOWN_CATEGORY_PREFIXES` are an *a-priori design* (CATEGORIES_AND_TAGS.md), never validated against real corpora. There's no feedback loop telling us the set is right. Two signals we currently THROW AWAY: (1) every rejected/improvised `type:` (the `type: pattern` incident — Claude reaching for a category that doesn't exist may be the corpus voting for a gap, not a typo); (2) `reference` becoming a catch-all dumping ground (32/56 of automation's files landed there — coarse-category smell). Instrument both: log rejected types + per-category distribution, so Rule-3 ("recurs + doesn't fit + distinct intent") becomes EVIDENCE-driven instead of waiting for a human to notice. Pairs with making the category list data-driven (config, not hardcoded const) + skill up-front validation so a legit new category is a deliberate config edit and a typo is refused in-session — not both silently aborting the embed identically. **UX sketch (user 2026-06-15):** create-context detects an unknown type and prompts *"Creating context… category 'X' doesn't exist. Create it, or choose: decision / gotcha / reference / …"* — turning the silent abort into an in-session choice. | user question 2026-06-15; the `type:pattern` phantom | KNOWN_CATEGORY_PREFIXES (const→config), rejection logging | **"Measure don't assume" — same principle as the opus-metrics-critique.** The taxonomy should be falsifiable by usage. (Resilience half — quarantine bad files instead of aborting — already shipped 2026-06-15; this entry is the taxonomy/registration half.) |
| **Full Layer-1 auto-docs** — `generate-docs` + `docs/generated/*.md`, overwritten each run. **Requires** namespacing under `docs/generated/` so it never clobbers hand-written specs. | Self-doc §2.2 | `/introspect` (v1 has this) | Independent; slot anytime |
| **Model self-doc (Layer 2)** — 5-field phase-boundary entries → `docs/SELF_DOCUMENTING_IMPLEMENTATION.md`. | Self-doc §3 | — | Process convention; can start anytime |
| **Retrieval relevance gate (replaces absolute floor)** — top-K + relative-separation gating instead of a single similarity floor. v1's floor is a stopgap: measured #1↔#2 separation is ~0.02 (smooth ramp), so no absolute number cleanly separates. | floor-calibration-signals; Phase 6 | CAE gate (CAE ranks similarity last, §4.4) | Buildable once CAE lands; the honest successor to `injectionFloor` |

### Track B — gated on dogfooding (needs real usage data first)

**Do not start these until contextus has been used enough to produce the data they need.**
A fast build week should leave these *open on purpose*, not rush them.

| Item | Source | Depends On | Why it's gated |
|------|--------|------------|----------------|
| **CAE cost model** — per-prompt Haiku call: acceptable latency, or batch candidates? | CAE §12 | CAE gate | Needs real latency/usage numbers to decide; can't be judged cold |
| **Hard-override authorship/provenance** — *who/how* `deprecated`, `canonical`, `manually-promoted` get written (no mechanism yet). | CAE §4.3 | CAE gate | Needs real `deprecated`/`canonical` cases to arise before designing the authoring path |
| **Tag-driven gating** — tags become live constraint modifiers (`tag_alignment`, deprecated/canonical overrides). | CAE §3, Categories §8 | CAE gate | Follows CAE *and* benefits from accumulated tag/rejection evidence |
| **Removal / governance** — soft (CAE demotion) / hard (deletion) / replacement (supersession), driven by accumulated rejection evidence. | CAE §7 | rejection logging (v1 has this) | Needs accumulated rejection evidence to act on |
| **Tag backfill maturity** — v1 ships `/tag-context` (subagent proposes, user approves). v2: auto-tagging confidence + bulk apply, once tags are load-bearing. | Phase 6 tag-context | tag-driven gating | Tags inert until CAE consumes them — no point maturing before then |
| **claude-mem → context promotion** (user idea, 2026-06-15) — detect claude-mem as a *content source* and graduate worthwhile observations into `.claude/context/`. claude-mem is reactive (searched on trigger patterns, returns observations); contextus is proactive (auto-injects). The bridge: when a claude-mem observation is surfaced in a search AND actually *used* in a response, promote it to a curated context pattern so it injects proactively next time instead of waiting to be searched. Closes the CLAUDE.md "normative vs observational, they complement" gap with a one-way ratchet: observed history → usage signal → proactive pattern. | user idea 2026-06-15 | usage signal (calibration), `novelty.ts` (dedup), `SOURCE_WEIGHTS` (provenance), reclassify heuristic (memory-migrate) | **Gated**: "worthwhile" = the same use_count-not-hit_count signal as opus-metrics-critique — undefinable without real usage data. On promotion: an observation has no category (run the reclassify judgment), must dedup vs existing context (`novelty.ts`), and should be stamped `source: claude-mem` (new SOURCE_WEIGHTS key, likely down-ranked below hand-authored) so governance/removal can reason about promoted-vs-authored. Overlaps the **Hard-override provenance** open question. Promotion should be *proposed* (awareness-footer / skill), not silent — same propose-not-auto stance as capture mode. |
| **Optional transcript mining during `/contextus-setup`** (user idea, 2026-06-18) — offer to bootstrap corpus from recent session transcripts on first-run. After scaffolding `.claude/context/`, prompt user: "Found 45 recent sessions. Run pattern discovery? Scans last 30 days, extracts ~5-10 proposals, uses Haiku (~$0.03), 2-5min background." If yes: scan `~/.claude/projects/<slug>/*.jsonl`, extract candidates (Haiku), store proposals, notify when done, user reviews via `/review-proposals` before commit. Benefits: new users start with 5-10 patterns vs 0; opt-in (no surprise cost); scoped (30 days, not exhaustive); quality gate (user reviews); background (doesn't block setup); cheap (~$0.03 = 100k input + 5k output @ Haiku rates). Implementation: incremental (last N days), keyword clustering first (cheap pre-filter), Haiku for extraction/structuring, temp proposals area. Complements `/migrate-memory` (different source). | user idea 2026-06-18 | usage signal (what patterns are "worthwhile"?), transcript schema (stable JSONL format) | **Gated**: "worthwhile" signals are the same issue as claude-mem promotion — undefinable cold. Needs real usage data to know which extracted patterns are valuable vs noise. The extraction mechanics are buildable now (transcripts are well-structured); the JUDGMENT (keep vs discard) needs evidence. Related: this is the cold-start half of transcript mining; claude-mem promotion is the ongoing/incremental half. |

### Track C — performance & reliability (buildable now, no data needed)

| Item | Depends On | Notes |
|------|------------|-------|
| **Pre-warm expansion model at SessionStart** — qwen2.5:3b takes 9.5s cold but 443ms warm. Ollama unloads idle models, so expansion consistently times out on first fire per session. Fix: ping `/api/generate` with a trivial prompt during SessionStart (like we do for nomic-embed-text). Costs ~200ms of session-start budget, saves 5s on first expansion-triggering query. | SessionStart hook | Measured 2026-06-18: cold=9.5s, warm=443ms, timeout=5s → expansion never produces results on cold start. Bedrock Haiku is 2.2s consistent (no cold-start) but 5x slower warm. Keep Ollama primary, pre-warm to avoid the cliff. |
| **Expansion timeout budget** — 5s timeout is too tight for cold Ollama (9.5s) but too generous for warm (443ms). Consider adaptive timeout: short for warm path (2s), let fallback handle cold failures faster. Or: detect model loaded state via Ollama API before calling. | Pre-warm item above | Related: if pre-warm lands, this becomes less urgent |

### Open Questions

These need design decisions before implementation:

1. **CAE cost model** — Is per-prompt Haiku call worth the latency? Need real usage data to decide. (CAE §12 lists batching candidates into one call as a future layer.)
2. **Floor-vs-CAE authority** — If floor says inject but CAE says reject, who wins? (Likely: CAE is final gate; CAE §4.4 ranks similarity *last*.) Confirm the cheap floor still short-circuits *before* any CAE call so we don't pay for an LLM verdict on a chunk the floor already killed.
3. **Hard-override provenance** — Define *who/how* `deprecated`, `canonical`, `manually-promoted` get written. (Open question in CAE spec — no mechanism yet.)
4. **Auto-doc namespace** — Decided `docs/generated/` above, but not formalized in Self-doc spec yet.
5. **LanceDB layout — table name + per-project isolation** (raised 2026-06-15 during automation migration). Two separable knobs: (a) the table inside every project DB is hardcoded `contextus` — rename? (cosmetic unless it collides with a shared-DB design); (b) today each project gets its own DB under `~/.contextus/data/<project>/`, fully isolated — should projects *share* one LanceDB (one table + a `project` column filter) instead? Sharing buys cross-project recall and a single warm connection but trades away the deliberate per-project isolation (see MIGRATION_GUIDE FAQ "global ~/.claude/memory" — a first-class global layer is already a v2 idea). These two questions are entangled: a shared DB forces the table-name + filtering decision. Refinement, not blocking — v1 per-project isolation works.

### Settled (recorded so they aren't re-litigated)

- **Three orthogonal footer/capture axes — don't conflate them** (clarified 2026-06-15).
  (a) `retrieval.provenanceFooter` (built, per-project): show/hide the `Context: used:`
  line — pure display, default on. (b) `contextCapture.mode = propose|silent`: whether
  the `Context: propose:` *capture* footer appears — this is LOAD-BEARING (it's how new
  patterns get saved; without it the plugin has no capture path), so it stays always-on
  by default. (c) `contextCapture.mode = auto` (v2, **recommended OFF**): write context
  files without asking — auto-capturing un-vetted patterns is worse than manual capture
  of good ones, so gate on the CAE first. **Coupling:** the axes are independent in code,
  but when `auto` is on the `propose:` footer is moot (nothing to ask) → it should
  suppress itself or downgrade to a terse "created:" receipt. So: propose-footer display
  follows from capture mode; the `used:` footer is fully independent.

- **No closed-loop auto-adjusting floor.** A background loop that watches usage and continuously nudges `injectionFloor` without a human is **deliberately not planned** (decision 2026-06-14). The two-signal model covers the need: floor-replay sets the cold-start value, usage-eval *recommends* refinements that a human applies. The longer-term bet is to *replace* the absolute floor with the CAE/relative-separation gate, not auto-tune it — so an auto-floor only makes sense (if ever) as a v3 idea *after* CAE exists, by which point the absolute floor is just a cheap pre-filter.

---

## Corpus Reconciliation & Deletion Detection

**Status: PARTIALLY SHIPPED (PR #9, 2026-06-18)**

### What shipped
- **fs.watch-based live deletion** — daemon watches `.claude/context/` directories. On file removal, deletes orphan rows from LanceDB immediately. Works reliably on **macOS** (recursive watch supported since Node 19+).
- **embedSingleFile deletion path** — when notified about a non-existent file, detects via `getContentHashes` and calls `deleteByFilename`.
- **Session-start reconcile** — already catches new/modified files; combined with fs.watch, covers all CRUD operations.

### Platform limitation: Linux
Node.js `fs.watch({ recursive: true })` is **not supported on Linux** (only macOS and Windows). On Linux the watcher silently does nothing — deletions are only caught at next session-start reconcile. Options for Linux:
- Fall back to `chokidar` (adds a dependency, heavier)
- Use inotify bindings directly (complex, no recursive equivalent)
- Accept the gap: reconcile-on-start is sufficient since context files change rarely

**Decision:** Accept the gap for now. Linux users get reconcile-on-start cleanup; macOS/Windows users get live deletion. Not worth a heavy dependency for rare events.

### Remaining gaps
- **File moves/renames** — treated as delete+add (content_hash detects it's the same content on re-add, no duplicate embed)
- **Bulk operations** — handled naturally (each 'rename' event fires independently)

### Related v2 work
- Full removal/governance model (soft/hard/replacement from CAE spec)
- Corpus versioning (track DB state vs filesystem state)
- Rejection-driven removal from quality evaluation

---

## Maintenance

This doc should be updated:
- **After v1 ships** — add any deferred items discovered during hardening
- **When design questions get answers** — move from "Open Questions" to actionable backlog items
- **As v2 work begins** — track what's in progress vs still backlog
