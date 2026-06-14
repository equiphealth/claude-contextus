# V2 Roadmap

Post-v1 feature backlog and open design questions. Items listed roughly by dependency order.

**Status:** v1 build in progress (Phase 6). This doc captures what's deliberately deferred.

---

## V2 Backlog

Shaped by the CAE, Categories, Self-Documentation, and Removal design docs. None of these block a trustworthy v1.

**Ordered by readiness, not just dependency** (2026-06-14). The dependency graph still
matters (it's the "Depends On" column), but for *sequencing a work session* the question
that matters more is: **can I act on this now, or does it need real dogfooding data first?**
Two tracks below. CAE is the keystone either way — most of Track A's later items hang off it.

### Track A — buildable now (no usage data required)

Roughly in build order; CAE first because it unblocks the most.

| Item | Source | Depends On | Notes |
|------|--------|------------|-------|
| **CAE gate** — Haiku applicability sub-agent per candidate, scoring rubric (§4), hard overrides, conflict priority. Slots in as `… → floor → CAE → inject`. | CAE spec | v1 floor + rejection logging | The keystone — tag-gating, removal, and the relevance-gate all hang off it. (Its *cost model* is Track B.) |
| **Deletion detection** — Delete-tool hook + session-start orphan cleanup. Phase 6 reconcile already handles new + modified files; the gap is *removal*. | (discovered 2026-06-14) | Phase 6 auto-reconcile infrastructure | Self-contained, no CAE dependency. See details below |
| **Per-category retrieval config** — Category Rule 4: each category declares injection trigger, weight, scope, merge/compete behavior. Re-ranker reads it. | Categories §3 (Rule 4) | re-ranker | Independent re-ranker work |
| **Multi-source incremental refresh** — v1's watch/reconcile path is `.claude/context/`-only; doc + user packs refresh only on a full `pnpm run embed`. v2: incrementally re-embed docs on change too (slower-changing, noisier). | Phase 6 multi-source | v1 multi-source ingest | The docs auto-refresh gap; deliberate v1 scope cut |
| **Smarter chunking** — v1 ships fixed header-split + token-fallback with collapse-to-file. v2: semantic/recursive chunking, per-source chunk sizing (docs ≠ context), chunk-level dedup, tuning `topK × fanout`. | Phase 6 chunking | v1 chunker | Chunking pulled into v1 (nomic 2048 cap); maturity is v2 |
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

### Open Questions

These need design decisions before implementation:

1. **CAE cost model** — Is per-prompt Haiku call worth the latency? Need real usage data to decide. (CAE §12 lists batching candidates into one call as a future layer.)
2. **Floor-vs-CAE authority** — If floor says inject but CAE says reject, who wins? (Likely: CAE is final gate; CAE §4.4 ranks similarity *last*.) Confirm the cheap floor still short-circuits *before* any CAE call so we don't pay for an LLM verdict on a chunk the floor already killed.
3. **Hard-override provenance** — Define *who/how* `deprecated`, `canonical`, `manually-promoted` get written. (Open question in CAE spec — no mechanism yet.)
4. **Auto-doc namespace** — Decided `docs/generated/` above, but not formalized in Self-doc spec yet.

### Settled (recorded so they aren't re-litigated)

- **No closed-loop auto-adjusting floor.** A background loop that watches usage and continuously nudges `injectionFloor` without a human is **deliberately not planned** (decision 2026-06-14). The two-signal model covers the need: floor-replay sets the cold-start value, usage-eval *recommends* refinements that a human applies. The longer-term bet is to *replace* the absolute floor with the CAE/relative-separation gate, not auto-tune it — so an auto-floor only makes sense (if ever) as a v3 idea *after* CAE exists, by which point the absolute floor is just a cheap pre-filter.

---

## Corpus Reconciliation & Deletion Detection

**Problem:** V1 has no detection or cleanup when `.claude/context/` or `.claude/docs/` files are deleted. Orphaned rows stay in LanceDB indefinitely. Also doesn't detect new files added between sessions (only catches edits via PostToolUse hook).

**V2 Solution:**

### During session
- Add `Delete` tool to PostToolUse hook filter (currently only watches `Write|Edit|MultiEdit|NotebookEdit`)
- When a context/doc file is deleted → daemon removes corresponding rows immediately

### Between sessions
Session-start reconciliation (builds on Phase 6 auto-reconcile infrastructure):
- Scan `.claude/context/` + `.claude/docs/` filesystem
- Compare against LanceDB rows
- **Missing files** → remove orphaned rows
- **New files** (never embedded) → background embed
- **Modified files** → already handled by staleness check (content_hash)

### Edge cases
- **File moves/renames** (path changes, content same) — treat as delete+add or detect via content_hash?
- **Bulk operations** (delete a whole category folder) — batch cleanup, not per-file

### Related v2 work
- Full removal/governance model (soft/hard/replacement from CAE spec)
- Corpus versioning (track DB state vs filesystem state)
- Rejection-driven removal from quality evaluation

**Why v2, not v1:**
- Requires robust reconciliation infrastructure (Phase 6 establishes basics, but full sync is more complex)
- Deletion is less urgent than it seems — orphaned rows can still match queries, but staleness/hit-count will naturally demote them over time
- Clean design requires thinking through all the edge cases (renames, bulk ops, race conditions between watch hook and reconciliation)

**Discovered:** 2026-06-14 during Phase 6 review

---

## Maintenance

This doc should be updated:
- **After v1 ships** — add any deferred items discovered during hardening
- **When design questions get answers** — move from "Open Questions" to actionable backlog items
- **As v2 work begins** — track what's in progress vs still backlog
