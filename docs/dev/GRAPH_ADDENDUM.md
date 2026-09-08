# GRAPH.md: Review Addendum

_Date: September 8, 2026_
_Source: Review conversation with Claude Sonnet 5, following a proposal from another LLM (GRAPH.md)_

GRAPH.md is a well-scoped, disciplined proposal — it explicitly protects against contextus becoming a knowledge-graph platform, insists on validating every phase through the existing usage-eval loop before trusting it, and avoids LLM-generated edges as the primary mechanism. That discipline is real and matches how this codebase already thinks about scope creep (CLAUDE.md's own "quality over vanity metrics," "graceful degradation," "file-based everything" principles).

This addendum's conclusion, though, is different from the source document's: **this should not be built as a contextus subsystem.** It should be a separate, sibling local tool, with contextus's own involvement limited to a thin *optional* integration — the same shape as the already-sketched claude-mem bridge in `DESIGN.md`'s "claude-mem Integration (v2+)" section. Where GRAPH.md conflicts with that conclusion, this document takes precedence; where it doesn't (the architectural instincts in its sections 4–7, 13, 15), it still stands and should inform whatever the sibling tool ends up being.

---

## 1. Why This Is a New Project, Not a Contextus Feature

**Issue:** GRAPH.md proposes first-class `Project`/`Source`/`Pattern`/`Session` graph nodes, a persistent local graph store, cross-repo edge semantics, and cycle handling — living inside contextus's own daemon and retrieval pipeline.

**Reframe:** That's a different data model with a different reason to exist. Contextus's corpus is deliberately narrow — per-project curated markdown, retrieved and injected, measured by usage. A graph of *the whole local dev environment's relationships* (which projects depend on which, which patterns recur across repos, which sessions touched what) is a general-purpose local dev tool, not a contextus internal mechanism. GRAPH.md's own section 13 says "the graph should never become the product" — but an internal module boundary is exactly the kind of boundary that erodes under feature pressure over time. An actual process/repo boundary doesn't erode by accident; crossing it requires a deliberate decision.

**Tell worth noticing:** GRAPH.md's own diagrams repeatedly use `vector-inspector` as the example "other linked project." That's suggestive — the natural shape here is a graph tool that sits *alongside* contextus and vector-inspector, not inside either of them.

---

## 2. The Existing Precedent for the Right Shape

**Observation:** `DESIGN.md`'s "claude-mem Integration (v2+, when claude-mem is installed)" section already sketches exactly the right pattern for this: optional, thin, activates only if the other tool is present, contextus treats its output as one more signal to blend into reranking, never owns the other system's internals. Trigger condition: *"User has both `~/.contextus/` and `~/.claude-mem/` directories → enable integration automatically."*

**Recommendation:** A local context-graph tool should follow the identical shape. If `~/.local-context-graph/` (or whatever it ends up being called) exists, contextus queries it for "related nodes near X" and folds the response into reranking as a bonus score — the same way the claude-mem bridge would. Contextus never owns graph storage, edge computation, or cycle detection. This resolves most of the technical risk below by construction: contextus isn't building or maintaining any of it, just consuming an optional external signal.

---

## 3. Technical Risks in GRAPH.md's V1, If Built Internally

These applied to the "build it inside contextus" framing. They mostly stop being contextus's problem under the sibling-tool model in §2, but they're worth recording here since whoever builds the sibling tool will still have to solve them:

- **Expansion needs to be adaptive, not core-path.** Contextus's existing query-expansion (`lib/retrieval/expand.ts`) only fires when `bestScore < 0.55`, specifically to protect the stated `<200ms` latency budget (`DESIGN.md`). GRAPH.md's proposed V1 flow (`semantic search → graph expansion → rerank → inject`) runs graph expansion unconditionally on every query. If graph expansion becomes a contextus-side consumption pattern under §2, it should gate the same way query expansion does — not always run.
- **"Deterministic edges" aren't uniformly cheap.** `link-project` edges and pattern→source edges are close to free (the data already exists). "Imports module" / "references same file" edges require a static-analysis subsystem — AST parsing, import graph construction — that doesn't exist anywhere in this codebase today. GRAPH.md's section 7 treats all deterministic edges as equally cheap; they aren't.
- **Phase 3 ("Learned Relationships") risks re-opening a closed decision.** `V2_ROADMAP.md:119` and `BUILD_LOG.md:342` explicitly decided against a closed-loop auto-adjusting injection floor on 2026-06-14 — the model is "usage-eval recommends, a human applies." Auto-weighting graph edges from usage feedback with no human step is the same shape of thing already declined once. Whatever consumes usage feedback to reweight edges needs the same recommend-not-auto-apply structure as the rest of calibration.
- **Sequencing, if any of this ever touches contextus's own code.** `daemon/server.ts` is ~1770 lines and issue #20 (extract the query pipeline into its own module) is still open. Anything that adds retrieval-path logic should land after #20, not before, or it compounds the thing #20 exists to fix.

---

## 4. What's Worth Keeping from GRAPH.md As-Is

Not everything above is a correction — several of GRAPH.md's instincts are correct regardless of which project ends up building this:

- The three-part framing in its closing section: *"The graph answers what's related. Semantic search answers what sounds relevant. Usage feedback answers what's actually useful."* — clean, accurate, worth reusing verbatim in whatever design doc the sibling tool ends up with.
- Section 7's "no LLM-generated edges as the primary mechanism, only low-confidence auxiliary ones" — right instinct, same reasoning contextus already applies to capture (deterministic I/O, LLM only for the judgment calls it's actually good at).
- Section 15's "what not to build yet" list — still correct advice for whoever builds this, unchanged by the reframe.

---

## Recommendation

Don't add this to contextus's V2 roadmap as an internal subsystem. If this idea gets pursued, it should start as its own small repo — a local graph store with a narrow read API (something like "given node X, return N related nodes with edge types") — with contextus (and vector-inspector, and anything else) as optional downstream consumers, following the claude-mem integration shape already sketched in `DESIGN.md`. GRAPH.md's phased structure (deterministic graph → graph-aware scoring → learned relationships → context propagation) is still a reasonable evolution path for that sibling project on its own terms — it just isn't contextus's phased roadmap.
