# Contextus Documentation Architecture — Final Specification

### A lean, three-layer documentation system designed for speed, clarity, and zero model slowdown

Contextus requires documentation at three distinct layers:

1. **System self-documentation** — rich, introspective, auto-generated
2. **Model implementation documentation** — minimal, phase-boundary only
3. **Context-as-documentation** — the implementation itself becomes the first context pack

This architecture ensures Contextus is self-describing without slowing down Claude Code or increasing token cost.

> **Read [§4.5 Scope & Boundaries](#45-scope--boundaries--self-documenting-during-the-build) before treating any layer as a requirement.** Sections 1–4 describe the aspirational ideal; §4.5 is the pragmatic v1 scoping and wins on conflict. In short: Layer 3 (context-as-documentation) is load-bearing; Layer 1 is `/introspect`-only in v1; Layer 2 is demoted to an ephemeral scratch buffer rather than a standing log.

---

# 1. Purpose

This specification defines how Contextus documents itself during development and runtime. The goals are:

- Keep the model fast
- Keep token cost low
- Maintain high-quality, accurate documentation
- Ensure the system can explain itself
- Ensure the implementation process produces structured, retrievable knowledge

Documentation is treated as a first-class output, but only where it provides real value.

---

# 2. Layer One — System Self-Documentation (Full Fidelity)

The system (daemon, hooks, embedding pipeline) is allowed to be verbose because it runs once and persists. This layer produces the authoritative, machine-generated documentation. It is **free in terms of token cost** and does not slow the model.

## 2.1 Introspection API

The daemon must expose the following endpoints.

### `/introspect`

Returns: version, embedding model + dimensions, LanceDB schema, loaded context packs, chunk counts, injection floor, re-ranking weights, hit-count statistics, last update timestamps, hook registration status, daemon uptime, last 10 retrieval summaries.

### `/introspect/retrieval`

Returns: query text, retrieved chunks, similarity scores, re-ranked scores, dropped chunks (with reasons), injected chunks (with ordering).

### `/introspect/packs`

Returns: pack name, version, tags, file list, chunk count, last updated timestamp.

### `/introspect/daemon`

Returns: status, uptime, port, model warm-load status, last `/query` and `/notify` timestamps.

## 2.2 Auto-Generated Documentation

A script (`generate-docs`) must:

1. Call all introspection endpoints
2. Read context pack manifests
3. Read embedding metadata
4. Generate the following files:

```
docs/ARCHITECTURE.md
docs/RETRIEVAL_PIPELINE.md
docs/CONTEXT_PACKS.md
docs/DAEMON.md
docs/HOOKS.md
docs/EMBEDDING_STORE.md
docs/INJECTION_LOGIC.md
```

These files must be overwritten on each run to prevent drift.

## 2.3 Runtime Logging

The daemon must log:

**Actions** — "Embedding model loaded", "Performed semantic search", "Applied injection floor", "Returned N injected chunks".

**Expectations** — "Expected LanceDB schema to contain vector column", "Expected model dimension = 768".

**Problems** — "Failed to bind port", "LanceDB insert failed", "Hook crashed during stdin read".

**Resolutions** — "Retrying port binding", "Re-loading model", "Re-creating LanceDB schema", "Restarting hook process".

> Full logging schema (analytics + human-readable formats): [LOGGING.md](LOGGING.md).

## 2.4 Hook Self-Documentation

Each hook must log: invocation timestamp, input received, output produced, errors encountered, recovery actions.

Each hook must support a `--describe` flag that prints: purpose, inputs, outputs, failure modes, recovery behavior.

## 2.5 Embedding Pipeline Documentation

During embedding, the system must record: file path, chunk count, embedding dimension, model name + version, timestamp, content hash, whether the chunk was updated or reused.

## 2.6 Final Requirement for Layer One

All Layer One documentation must be generated from the running system itself — **never hand-written** — ensuring accuracy, consistency, and zero drift.

---

# 3. Layer Two — Model Self-Documentation (Minimal, Cheap)

The model must remain fast and inexpensive. Therefore, its documentation must be tiny and only produced at meaningful boundaries.

## 3.1 When the Model Documents

Only at: start of a phase, end of a phase, a real problem, a design decision, a deviation from the plan. **Nothing else.**

## 3.2 Minimal Format (5 short fields)

Each entry uses this compact structure (each field 1–2 sentences max):

- **Attempt**: What I tried
- **Expectation**: What I thought would happen
- **Observation**: What actually happened
- **Change**: What I did
- **Next**: What I will do next

## 3.3 When the Model Must NOT Document

Routine code generation, minor fixes, formatting changes, imports, refactors, test scaffolding, retry loops. This keeps the model fast and avoids token bloat.

## 3.4 Logging Destination

All model-side logs append to `docs/SELF_DOCUMENTING_IMPLEMENTATION.md`.

---

# 4. Layer Three — Context-as-Documentation (Implementation as the First Context Pack)

The implementation process itself produces `.claude/context/` files formatted to Contextus context rules (YAML frontmatter, bold-key body, `[[wikilink]]` relations). These files become the first real context pack and are used by Contextus during its own build — **dogfooding from day one**.

Each context file stays concise and prefix-scoped so Contextus retrieves tight, relevant chunks. Anything beyond ~30 lines belongs in `docs/` with a one-liner reference left in the context file.

## 4.1 Context File Prefixes

The prefixes below are a **starting vocabulary, not a fixed schema**. New prefixes are acceptable whenever a category of knowledge emerges that doesn't fit an existing one — the only rule is that a new prefix gets a matching `metadata.type`. Don't create parallel prefixes for the same concept (e.g. both `gotcha-` and `bug-`); add intentionally, consolidate when two prefixes start to mean the same thing.

| **Prefix**  | **`metadata.type`** | **Purpose**                                  |
| ----------- | ------------------- | -------------------------------------------- |
| `arch-`     | `architecture`      | Component map, data flow, design shape       |
| `decision-` | `decision`          | Resolved choices, API surface findings       |
| `gotcha-`   | `gotcha`            | Build loop friction, things that burned time |
| `api-`      | `api`               | HTTP contracts, hook stdin/stdout specs      |
| `tradeoff-` | `tradeoff`          | "We considered X and Y, here's why Z"        |
| `phase-`    | `phase`             | Exit criteria met, DESIGN.md divergences     |

> The authoritative rules for choosing a category, when to create a new one, and how tags complement categories live in [CATEGORIES_AND_TAGS.md](CATEGORIES_AND_TAGS.md). Update the table above as new prefixes are added.

## 4.2 Context File Templates

### `arch-overview.md`

```
---
name: arch-overview
description: Component map and data flow for contextus
metadata:
  type: architecture
---

**Components**:
- **lance-client** — LanceDB file-mode, no server, schema from first record
- **embedder** — Transformers.js nomic-embed-text-v1.5, mean pool + normalize
- **daemon** — HTTP port 7891, model warm-loaded once at startup
- **hooks** — stateless thin clients, graceful degrade if daemon is down
- **scripts/** — embed-contexts, query, awareness, watch, session-start

**Data flow**:
- prompt → query-hook → daemon /query → re-rank + floor → inject block → Claude
- file change → watch-hook → daemon /notify → incremental re-embed → LanceDB

> Full design rationale: `docs/DESIGN.md`

**Related**: [[decision-lancedb]], [[api-daemon]], [[decision-daemon]]
```

### `decision-<topic>.md`

```
---
name: decision-lancedb
description: Resolved API surface and schema decisions for LanceDB integration
metadata:
  type: decision
---

**Decision**: Use `Table.add()` not `insert()` — DESIGN.md assumed wrong method.

**Findings**:
- Schema inferred from first record — dimensions must be correct before any write
- `query().limit(n).toArray()` is correct retrieval pattern — `.execute()` does not exist
- No migration path for dimension changes in v1 — drop and recreate table

> Extended notes: `docs/lancedb-integration.md`

**Related**: [[arch-overview]], [[gotcha-transformers]]
```

### `gotcha-<area>.md`

```
---
name: gotcha-transformers
description: Transformers.js friction points found during Phase 1 build
metadata:
  type: gotcha
---

**Area**: Transformers.js / embedding model

**Findings**:
- Model warm-load takes 2–10s on first call — gate on `modelLoaded` before serving `/query`
- `env.cacheDir` must be set before first pipeline call or defaults to process cwd
- First run downloads ~138MB — document prominently in README
- Mean pooling is manual — Transformers.js does not expose it directly

**Related**: [[decision-daemon]], [[arch-overview]]
```

### `api-daemon.md`

```
---
name: api-daemon
description: Daemon HTTP contract — endpoints, request and response shapes
metadata:
  type: api
---

**Base URL**: `http://localhost:7891`

**GET /health** → `{ status, modelLoaded: bool, uptime: float }`

**POST /query**
Request: `{ prompt, sessionId, limit? }`
Response: `{ chunks: [{ id, source, content, score }], injected: bool, floorApplied: bool }`

**POST /notify**
Request: `{ filePath }` → Response: `{ queued: bool }`

> Hook stdin/stdout contract: `api-hooks.md`

**Related**: [[decision-daemon]], [[arch-overview]]
```

### `phase-<n>.md`

```
---
name: phase-0
description: Phase 0 exit log — demolition and LanceDB foundation
metadata:
  type: phase
---

**Exit criteria met**: `lance-client` connects, creates table, round-trips one record.

**Changes from DESIGN.md**:
- ChromaDB fully removed — replaced with `@lancedb/lancedb`
- `Table.add()` not `insert()` (see [[decision-lancedb]])
- ESM config required — not mentioned in DESIGN.md (see [[gotcha-esm]])

**Related**: [[decision-lancedb]], [[gotcha-esm]], [[arch-overview]]
```

## 4.3 Documentation Workflow

### Phase Boundary Rule

At the end of each phase, spend **5 minutes**:

1. Write/update the relevant `decision-` and `gotcha-` files
2. Write the `phase-<n>.md` exit log
3. Update `arch-overview.md` if any component changed from DESIGN.md

Keep a scratch buffer during the build loop and flush to context files at the boundary — don't document mid-phase.

### Promotion Rule

If a context file grows beyond ~30 lines, promote the overflow to `docs/` and leave a reference:

```
> Extended notes: `docs/daemon-crash-recovery.md`
```

### Self-Validation

After Phase 1, run `npm run embed` on the context files themselves. If Contextus injects `gotcha-*` and `decision-*` entries into relevant prompts, the pipeline and the docs are both working.

## 4.4 README Sections to Write Post-Phase 2

Stubs during build, filled in once the spine is working. Pull content directly from context files:

- **How it works** — from `arch-overview.md`
- **Quick start** — `npm run embed` → `npm run session-start` → open Claude
- **Troubleshooting** — pull from `gotcha-*` files directly
- **Context file format** — what goes in `.claude/context/` and how chunks are structured

---

# 4.5 Scope & Boundaries — Self-Documenting *During* the Build

_Added 2026-06-14. This section is the pragmatic counterweight to the maximalist framing above. Where it conflicts with the aspirational text, this section wins for v1._

The Layers above describe an ideal. Two of them are load-bearing; one mostly is not; and the act of an AI authoring its own context files during the build carries a risk unique to this project. Read this before treating any Layer as a hard requirement.

## 4.5.1 The corpus-truth risk (the one that matters most)

Contextus is different from a normal project: **anything written into `.claude/context/` during the build becomes the corpus.** It gets embedded and later *proactively injected* into future sessions as an authoritative pattern.

This raises the stakes on build-time self-documentation:

- A `gotcha-` written at the moment of pain — before the fix is confirmed — is not a stale note. It is **confident fiction the system will resurface**, wearing the "retrieved pattern" badge.
- **A wrong context file is worse than no context file.** No-injection is a first-class, designed outcome (the injection floor exists precisely for this). A plausible-but-wrong injected pattern is the expensive failure mode.
- The author (Claude) narrates *intended* decisions, which are not always what the code does. Self-authored docs drift toward plausible-but-wrong without a verification beat.

**Rule: a context file is written from verified state, not from memory.** Before a `decision-`/`gotcha-`/`api-` file is embedded, its claims are checked against the code or a passing test. "I think I used `.add()`" is a scratch note; "`Table.add()`, confirmed by `phase-0` round-trip test" is corpus-worthy.

## 4.5.2 One ledger, not four

Build knowledge can land in four places, and the layers above reconcile none of them:

1. Layer 2's 5-field logs (`SELF_DOCUMENTING_IMPLEMENTATION.md`)
2. Layer 3's `.claude/context/` files
3. Git commit messages
4. **claude-mem** — which is *already* passively capturing observations of this build

Layer 2's format (Attempt / Expectation / Observation / Change / Next) is nearly a good commit message, which is nearly a claude-mem observation. Keeping all four means writing the same fact ("`.add()` not `.insert()`") three or four times — and it is faintly absurd for a context-capture project to reinvent capture it already has running.

**The intended division of labor:**

| Knowledge type | Home | Why |
|---|---|---|
| Curated, injectable patterns | `.claude/context/` (Layer 3) | This *is* the product corpus — distilled, verified, worth resurfacing |
| Point-in-time rationale ("why this change") | Git commit messages | Already the right tool; timestamped, diff-anchored |
| Live system state | `/introspect` (Layer 1, v1 scope) | Can't drift; tedious to hand-maintain |
| Raw build narration | claude-mem (passive) | Already running; no extra effort |

**Layer 2 is demoted to a scratch buffer, not a fourth ledger.** It is the *working notes* kept during a phase, then **distilled and verified into Layer 3 context files at the phase boundary** — exactly the flush described in §4.3. Its separate destination file (`SELF_DOCUMENTING_IMPLEMENTATION.md`) is not a v1 requirement; the buffer can be ephemeral.

## 4.5.3 Layer 1's rule, inverted

The spec says all documentation "must be generated from the running system — never hand-written." That is correct for **state**, backwards for **rationale**:

- **Auto-generate state** — schema, dimensions, re-rank weights, chunk counts, uptime. Can't drift, tedious by hand. This is what `/introspect` is for, and it is the *only* Layer 1 piece in v1 scope.
- **Hand-write rationale** — "why LanceDB over Chroma," the floor-as-primary-lever argument, the honest-metrics framing. Introspection cannot produce these; `DESIGN.md` already does, better.

The literal rule would have a script overwrite the project's best thinking with a state dump. **`generate-docs` and the seven auto-doc files are deferred to v2 and, when built, must emit under `docs/generated/` so they can never clobber hand-written specs.** "Never hand-written" applies only to the generated half.

## 4.5.4 The self-grading blind spot

The self-validation step (§4.3) — embed the context files, confirm contextus injects `gotcha-*` into a relevant prompt — is genuinely valuable: it is a live end-to-end test of the whole pipeline on real content. **But the same author writes the corpus *and* judges whether retrieval worked on it.** Two caveats:

- It validates the *pipeline*, not *retrieval quality on the corpus type users will have*. A build corpus skews heavily to `gotcha-`/`decision-` (you're fighting tooling all day); the normative "how we do X" patterns contextus is really meant to serve are under-represented. "It injected my gotchas" ≠ "retrieval is calibrated."
- Treat it as a smoke test (does the wiring work?), not a quality measurement. Quality measurement is the calibration eval, with its deliberately separate Haiku judge.

## 4.5.5 Net guidance for the build

- **Keep Layer 3.** It's the product corpus and the best integration test you have. Write verified, distilled files at phase boundaries.
- **Demote Layer 2** to an ephemeral scratch buffer that flushes into Layer 3. Don't maintain it as a standing parallel log.
- **Layer 1 = `/introspect` only** in v1; auto-docs are v2 under `docs/generated/`.
- **Lean on commits + claude-mem** for raw narration and rationale instead of inventing a fourth ledger.
- **Verify before embedding.** A context file is corpus, not a diary entry — and the corpus is the thing users will trust.

---

# 5. How the Three Layers Work Together

| **Layer**    | **Purpose**                    | **Cost** | **Frequency** |
| ------------ | ------------------------------ | -------- | ------------- |
| System       | Full introspection + auto-docs | Free     | Continuous    |
| Model        | Minimal phase-boundary logs    | Very low | Occasional    |
| Context Pack | Semantic knowledge             | Low      | As needed     |

This balance ensures Contextus is self-describing without slowing development.

---

# 6. Final Summary

**System** — Introspection over auto-docs. v1 ships `/introspect` (live state, can't drift); full `generate-docs` is v2 under `docs/generated/`. State is auto-generated; rationale stays hand-written in `DESIGN.md` et al.

**Model** — Not a standing log. An ephemeral scratch buffer during a phase, distilled and **verified** into context files at the boundary. Raw narration leans on commits + claude-mem rather than a fourth ledger.

**Context Pack** — The load-bearing layer. Implementation produces prefix-scoped, atomic, semantic `.claude/context/` files; dogfooding from day one. Because these files *become the injected corpus*, they are written from verified state, not from memory — a wrong pattern is worse than no pattern.

This architecture provides maximum clarity with minimal overhead, ensuring Contextus remains fast, deterministic, and self-describing — while keeping the corpus trustworthy and the ledgers from multiplying. See §4.5 for the full reasoning.
