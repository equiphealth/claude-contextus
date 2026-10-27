# Contextus for Muse Code  -  Porting Doc (pre-contest planning)

**Status of this document, read first  -  labelled pre-contest planning**

- Written 2026-10-25, *before* the Meta hackathon build window (Mon Oct 26, 1:00 PM - Wed Nov 4, 9:00 PM ET), with a Meta AI provider section added 2026-10-26, also before the window.
- Label: **pre-contest planning**. This is the document Anthony already had, now labelled as such, not a new in-window build doc.
- Purpose: for Anthony to **review Spark's work**  -  how accurately and honestly Spark can describe a port of Contextus to Muse Code from the full repo. It is **not** to be fed into Muse Code as a build prompt, and it is **not** a hackathon submission artifact.
- The actual port code is to be built in the window. If any part of this doc later ends up in the submission, it must be disclosed as pre-window planning material, in the same way Contextus itself  -  a pre-existing project  -  must be disclosed as pre-built work.
- Source of truth: the review copy at `~/workspace/contextus-review/claude-contextus-main/`, Contextus **0.20.0**, `claude-contextus`, Node `>=22`, ESM (`"type": "module"`). That copy was **read only**. Nothing in it was run, installed, or edited for this doc.
- Cross-references, not copies: `~/workspace/your_files/hackathon-build-plan/build-plan.md` (day-by-day plan, minimum shippable line, cut order) and `~/workspace/your_files/contextus-injection-flow.md` (the full injection pipeline). This doc does not repeat them verbatim; it answers a different question  -  *what exactly has to change to move from Claude Code to Muse Code, and what is still unknown?*
- Honesty rule used throughout, with two distinct states, used consistently in every section: **DOCUMENTED, NOT LIVE-VERIFIED** means the fact is in the published Muse Code SDK docs, labelled 1.4, with values checked against Muse Code 1.3.0, but has not been confirmed in a live Muse Code session on the installed version; **LIVE-UNVERIFIED** means it is not in those docs as excerpted in §8.0, or the docs themselves leave it open, and Phase 0 must test it live. No Muse Code hook name, env var, stdout cap, or session-id field is invented here. The earlier build plan's 16 KiB stdout cap is now a documented figure, not a guess, but its behaviour in practice is still live-unverified; the build plan's 14 KB `additionalContext` ceiling is not in the §8.0 docs as excerpted, so it stays live-unverified, not documented.

---

## 1. The one-sentence port

Contextus is two things, and only one of them is host-specific:

1. **A host-independent core**  -  a Node/TypeScript daemon, a LanceDB retrieval pipeline, and a markdown corpus. This should not change.
2. **A thin host adapter**  -  Claude Code hooks, Claude Code env vars, Claude Code plugin manifests, Claude-style skill files, and a Claude Code statusline. *All* of this is what the port has to replace, shim, or prove equivalent.

If the port touches the core to make the adapter work, that is a smell. The adapter should be the only new code in the minimum port, plus one small daemon seam (see §2.4) that is host-neutral by design.

---

## 2. What stays unchanged

### 2.1 The daemon and its HTTP API  -  `daemon/server.ts`

The daemon is the product. The port does not rewrite it, re-embed the corpus for it, or change its storage. Its endpoints, as documented in the header of `daemon/server.ts` (lines ~15-24) and implemented in the request router (~lines 1620-1760), are:

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Liveness + readiness. `modelLoaded` is what SessionStart polls. Returns status, uptime, model state, LanceDB connection, embedding model. |
| `/novelty` | GET | Recently injected pattern names for a project  -  the awareness hook's novelty signal. |
| `/introspect` | GET | Live config + corpus stats (the self-doc layer). |
| `/query` | POST | The retrieval spine. Body: `{project, prompt, cwd, contextStats, sessionId}` in the current hook client. Returns `{continue, hookSpecificOutput?: {additionalContext}}` in Claude Code shape  -  see §3, because the *shape of the reply* is host-specific even though the *work* is not. |
| `/search` | POST | Raw corpus search without the injection floor  -  the `/context-search` skill path. |
| `/capture` | POST | Write a context/doc file atomically, embed it, update the index. Never hook-triggered; it does not return `{continue: true}`. |
| `/delete` | POST | Archive/remove. Same non-hook reasoning as `/capture`. |
| `/notify` | POST | Incremental re-embed of one changed file (PostToolUse path). Returns `{continue: true}` on *any* internal failure, like `/query`  -  hook-triggered endpoints degrade, they never block. |
| `/reconcile` | POST | Bring a project's corpus in line with its on-disk sources; `check` mode is the SessionStart safety net, full mode runs in the background. |

Daemon lifecycle facts that carry over unchanged:

- Daemon runs from compiled output, `node dist/daemon/server.js`, not from `tsx`. `dist/` is committed, guarded by a `verify:dist` step and CI. That is a deliberate compromise (Claude Code hooks run plain `node scripts/*.js` with no build step; the daemon is the one place a build is acceptable). A Muse port should keep that split unless Muse Code forces a different one  -  and if it does, that is a Phase 0 finding, not a redesign.
- First-run behaviour is daemon-side: warm the embedding model *after* the socket is listening, so `/health` is reachable while warming. SessionStart polls; it never hangs session start.
- The daemon also runs its own `fs.watch` (`watchContextDir`) once reconcile has run for a source. That is the backstop for edits made *outside* the host's tools. The PostToolUse hook is only the fast path for edits made *through* the host.

### 2.2 The retrieval pipeline  -  `lib/retrieval/`

This is the strongest part of the system and the part least in need of porting work. It is pure, deterministic, and host-independent. Files, in pipeline order:

1. **Embed**  -  `lib/embedding/embedder.ts`: `search_query:` prefix, nomic-embed-text, 768 dimensions, L2-normalised. LanceDB similarity is `1 - distance / 2`, scoped to `project IN (self + workspace siblings + __user__)`  -  that scope is how linked-workspace context surfaces.
2. **Fetch**  -  initial vector fetch is `topK × 4` (20 chunks at topK 5).
3. **Hybrid (adaptive)**  -  `lib/retrieval/hybrid.ts`: fires only if the best semantic score is below the floor. BM25-like scan (`topK × 3` candidates, K1 1.2, B 0.75, needs ≥2 meaningful terms), fused by Reciprocal Rank Fusion, k = 60. **Known quirk, preserved here honestly:** RRF shapes which candidates survive the fused slice, but the reranker then re-sorts by `finalScore`, discarding RRF order; and a keyword-only hit's similarity is halved, so it caps at 0.5 and cannot clear the 0.725 floor through hybrid alone. The rescue that actually works is a semantically-found chunk buried outside the initial 20, or the separate embedding-down keyword fallback (not halved, with a notice + rewarm). Do not "fix" this in the port unless you intend to change retrieval behaviour and re-calibrate  -  it is a behaviour, not a porting bug.
4. **Expansion (adaptive)**  -  `lib/retrieval/expand.ts`: fires only if the post-hybrid best is below **0.775**  -  note this is *above* the 0.725 floor, so there is a band where a query would already inject but still pays for expansion. Up to 3 variants from Ollama `qwen2.5:3b`, 5 s timeout, Bedrock Haiku fallback only if the primary fails fast with >500 ms left. Variants searched at `topK × 2`, unioned, deduped keeping the highest similarity. Expansion failure returns no variants; it never blocks retrieval.
5. **Rerank**  -  `lib/retrieval/reranker.ts`: `finalScore = similarity × sourceWeight × typeBoost × freshnessDecay × hitCountBoost`. Freshness: 180-day half-life. Hit-count boost: logarithmic, ~1.3 cap. Source weights: projectContext 1.0, projectDocs 0.9, siblingContext 0.85, userContext 0.8, parent/userDocs/custom 0.7. Type boosts: gotcha 1.2, tradeoff/security 1.1, api/perf 1.05, reference/schema/implementation 1.0, arch 0.95, decision 0.9, project/phase 0.8. **These weights are hardcoded** in `reranker.ts`; `rerank(results, now)` takes no config, and `RetrievalConfig` has no weight fields. Flattening/configuring them is Anthony's separate, post-hackathon plan (discussed 2026-10-25, not implemented)  -  not a port task.
6. **Collapse → slice → dedupe**  -  `lib/retrieval/dedup.ts`: one chunk per file *before* topK (so topK means files, not chunks), slice to topK, greedy dedupe dropping cosine ≥0.95.
7. **Floor**  -  `lib/retrieval/floor.ts`: gates on **raw similarity, not finalScore**. A boost can reorder; it can never lift an irrelevant chunk over the line.
8. **Format**  -  `lib/retrieval/inject-format.ts`: bracketed `[contextus  -  relevant project context]` header, chunks in reranked order with filename, section, similarity to two decimals, hit count, then body, greedily within `maxTokens` (3000, ~4 chars/token), first chunk always admitted. Provenance footer whitelists exactly the injected filenames + scores  -  the fix for a real 2026-06-15 session where the awareness footer hallucinated filenames when nothing had injected. The footer belongs here, with real data, not in the awareness hook.

Outcomes, unchanged:

- **Inject:** `additionalContext` with the block above (in Claude Code shape; see §3).
- **Near miss:** no inject, best >0.625, ≥1 dropped candidate → retrieval-gap notice (best, floor, gap, nearest topics, plus the reminder that injection is keyed once per turn to the opening prompt, so drift needs a manual `/context-search`).
- **Plain miss:** silent, logged as a first-class success, not a failure.
- After a real inject, hit counts are bumped best-effort, feeding the reranker next time.

### 2.3 The corpus format  -  `.claude/context/` and `docs/`

The corpus is inspectable markdown in the repo; LanceDB is the retrieval index, not the source. That principle must survive the port, because it is the whole inspectability argument.

- Project context lives in `.claude/context/` (per `plugin.jsonc` source `projectContext`, index file `CONTEXT.md`, excluding `CONTEXT.md`, `README.md`, `.archive/**`). Project docs live in `docs/` (`projectDocs`, index `DOCS.md`). User-scoped sources live under `~/.contextus/context/` and `~/.contextus/docs/`.
- Files carry frontmatter (name, description, `metadata.type`, `metadata.tags`) plus body. `CONTEXT.md` is a one-line-per-file index organised by category  -  see the review copy's own `.claude/context/CONTEXT.md` for the shape (Decisions / Questions / Gotchas / Tradeoffs / Implementation, etc.).
- **Porting question, now a proposal to fit into the port:** does the Muse port keep the literal `.claude/` directory name, rename to a `.muse/` equivalent, or standardise on a neutral default path? Keeping `.claude/` is the least-work, least-risk choice for the minimum port (the daemon's source paths, the index files, and the seeded vector-inspector corpus all point there), but it looks odd in a Muse submission and may confuse Muse Code's own discovery. Renaming to `.muse/` just swaps one host name for another, and a project used from both hosts would then have two corpora, or a corpus in the wrong host's directory.
- **Neutral default proposal, added 2026-10-26 as pre-contest planning, to fit into the port:** standardise the project default on `.contextus/`, for context and for config, so Muse and Claude can share easily. Rationale, as discussed 2026-10-25: the paths are already configurable, the user-scoped paths are already neutral (`~/.contextus/context/`, `~/.contextus/docs/`), and a host-neutral `.contextus/` beats keeping `.claude/` (which is Claude-named in a Muse port) or renaming to `.muse/` (which is Muse-named in a Claude session). Both hosts would share one corpus, one config, and one embeddings index, with an origin field distinguishing which host captured what, alongside the existing per-request `agent` field in §2.4.
- **What fitting this into the port actually requires, not a silent find-and-replace:** a deliberate migration and read-both transition, because existing corpora live in `.claude/context/`, index files name that path, skills name that path, and the setup wizard scaffolds that path. Steps, in outline: change the project-context default in `plugin.jsonc` and `lib/config.ts` to `.contextus/context/` (and the project config override from `.claude/contextus.jsonc` to `.contextus/contextus.jsonc`, or keep the override name configurable), update every skill that names `.claude/context/` to the new default, update the setup wizard to scaffold `.contextus/`, and add a migration that reads both old and new paths during transition, moves or copies the corpus with git history preserved where possible, and re-embeds only if the index path changes in a way that invalidates it. Do not silently rename a live corpus in place, and do not drop the old path without a read-both period, or existing Claude users lose their corpus on upgrade.
- **Phase 0 test for this proposal, to add to §8:** in a test project, configure both a Claude-style session and a Muse session against the same `.contextus/` corpus, capture from one host, and retrieve from the other, with the origin field recorded. Pass is shared retrieval with correct origin, not two separate corpora. If that test fails, the neutral path is still a good Phase 2 standardisation, but the minimum port should keep `.claude/` for Phase 0 and treat the rename as a deliberate migration, not a blocker.
- Either way, the *format* (frontmatter + body + index) does not change. Only the default directory name, and the migration that gets there, change.
- Capture modes, unchanged in intent: `propose` (default  -  footer asks the model to propose a new file), `staging` (model writes directly, human reviews at git time), `silent` (no footer). The port must preserve the mode semantics even if the footer mechanism changes.

### 2.4 The one daemon seam the build plan already anticipates

The earlier build plan proposes a per-request `agent` field on `/query`, so the daemon knows which host is calling, and can emit a host-appropriate `hookEventName` and truncate `additionalContext` to the host's ceiling. That is the *right* shape of change: a host-neutral field, consumed by host-specific formatting at the edge, not a Muse branch through the retrieval pipeline. The documented Muse ceiling to truncate to is 16 KiB for stdout and stderr (§8.0, documented, not live-verified in practice); the seam is what enforces it at the edge.

What it is **not**: a rewrite of `handleQuery`, a second pipeline, or a Muse-specific embedding model. If Phase 0 shows Muse Code accepts the documented Muse hook output shape (§8.0) without extra truncation, this seam may not even be needed for the minimum port  -  and that would be a good result, because it means the daemon is already host-agnostic. Note the shape difference: Claude Code output includes `continue`, while the documented Muse JSON injection form is `hookSpecificOutput` with `hookEventName` and `additionalContext` under a closed camelCase schema, so "accepts the Claude shape verbatim" is not the test; "accepts the documented Muse shape" is.

### 2.5 Fail-open degradation  -  the non-negotiable

Every host-facing piece in the current system degrades to "no injection, session continues":

- Query hook: daemon down/slow → background restart, emit `{continue: true}`. One missed injection, never a blocked prompt. Bounded 10 s fetch timeout matching the hook timeout.
- Awareness hook: missing `prompts/*.txt` → inline fallback, not a crash (this is why the tarball's missing `prompts/` directory degrades rather than breaks).
- SessionStart: daemon problem never blocks session start; a cold first prompt just degrades to no-injection.
- PostToolUse: re-embed failure never blocks the tool result; daemon down → background respawn, file picked up by the next full embed or edit.
- Daemon `/query` / `/notify`: any internal failure → `{continue: true}`. `/capture` / `/delete` are explicitly *not* hook-triggered, so they do not carry that contract.
- Capacity guard: even at >85% (see §6), the daemon emits a warning block rather than going silent.

The Muse port must preserve every one of these. A port that blocks a Muse session while the daemon warms, or that crashes a prompt when the corpus is cold, has regressed the core design, however good its injection looks on camera.

---

## 3. Hook-by-hook mapping  -  `hooks/hooks.json`

`hooks/hooks.json` is the whole Claude Code contract in one file. It is reproduced here in substance, because every line of it is a porting question.

```json
{
  "hooks": {
    "SessionStart":  [{ "matcher": ".*",
      "hooks": [{ "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/session-start-hook.js\"",
        "timeout": 20000 }] }],
    "UserPromptSubmit": [
      { "matcher": ".*",
        "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/query-hook.js\"",
          "timeout": 10000 }] },
      { "matcher": ".*",
        "hooks": [{ "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/awareness-hook.js\"",
          "timeout": 5000 }] }],
    "PostToolUse": [{ "matcher": "Write|Edit|MultiEdit|NotebookEdit",
      "hooks": [{ "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/watch-contexts.js\"",
        "timeout": 8000 }] }],
    "Stop": [{ "matcher": ".*",
      "hooks": [
        { "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/stop-evaluation.js\"",
          "timeout": 5000 },
        { "type": "command",
          "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/capture-gate-hook.js\"",
          "timeout": 5000 }] }]
  }
}
```

Timeouts above are in **milliseconds** in Claude Code. In Muse Code, timeouts are **documented, not live-verified, in seconds, default 600** (§8.0). The adapter conversion is therefore ms to seconds, not a hypothesis about units; what Phase 0 must test live is timeout expiry behaviour on the installed version, not the unit.

General facts about all four hook scripts, from their headers:

- They are thin, plain ESM JavaScript (`node scripts/*.js`, no build step). The repo is `"type": "module"`, and hook files must be ESM and smoke-tested via stdin, not just unit-tested (a gotcha recorded in the corpus itself).
- They read their payload from **stdin as JSON**, never hang on a TTY (`if (process.stdin.isTTY) resolve('')`), and write **one JSON object to stdout**  -  except Stop, which emits nothing (see §3.4).
- They compute the project id the same way everywhere: `sha256` of the absolute cwd, first 12 hex chars (`scripts/lib/project-hash.js`, mirrored in `lib/config.ts`). That hash, not the path, is what the daemon keys on. Any Muse adapter must compute the *same* hash from the *same* cwd, or the daemon will look up the wrong project (or no project) and the port will appear to "not work" for a purely mechanical reason.
- They share `scripts/lib/`: `daemon-control.js` (base URL, ensure-running, wait-for-model), `daemon-status.js`, `project-hash.js`, `parse-jsonc.js`, `capture-gate.js`, `captures-log.js`. The Muse adapter should reuse these, not reimplement them  -  with one exception: anything that reads a Claude-specific env var must be abstracted (see each hook below).

### 3.1 SessionStart  -  `scripts/session-start-hook.js`, 20 s

**What it does (Claude Code):**

- Ensure the daemon is up and warm, then check whether the project's corpus actually exists (first-run onboarding). Spawns the daemon if needed, polls `/health` until the model is warm, bounded  -  never hangs session start.
- Auto-reconcile safety net: after the daemon is warm, POST `/reconcile` in check mode; if the corpus is cold/stale, fire a *background* full reconcile (never blocking) and report it.
- One-time discoverability nudge: if the project `CLAUDE.md` has no contextus stanza, suggest `/contextus-setup`. **This hook never edits `CLAUDE.md`**  -  that is solely `/contextus-setup`'s job.
- Transparency, by user preference: daemon state is reported via **`systemMessage`**  -  which renders to the *user* in the UI, **not** to the model's context. The header comment is explicit: "We deliberately never use `additionalContext` for this: announcing the daemon to Claude every session would pollute the very context window contextus exists to keep clean."
- Verbosity: `silent` (never emit), `normal` (noteworthy events only: fresh spawn, still-warming, reconcile, failure), `verbose` (plus a heartbeat when a warm daemon is found). Source: `config.notifications.verbosity` or `CONTEXTUS_VERBOSITY`.
- Housekeeping: cleans stale `~/.contextus/runtime/*.context-stats.json` files older than 24 h.

**Stdin it actually reads:** the SessionStart payload, used for `cwd` (the header says "Read the SessionStart payload from stdin (for cwd)").

**Stdout it emits:** `{continue: true}` plus, where warranted, a `systemMessage`. Never `additionalContext` for daemon announcements.

**Env it touches:** `CLAUDE_PLUGIN_ROOT` is *not* used by this script's own header (it is used by the hooks.json command line and by `stop-evaluation.js`); the script's daemon-control helpers resolve the daemon from the plugin root / home directory. Any Muse equivalent must be found, not assumed.

**Muse Code equivalent: DOCUMENTED, NOT LIVE-VERIFIED (§8.0).** SessionStart is a documented Muse event, matched on `source`: startup, resume, clear, compact, fork. Its documented stdin includes `cwd`, `session_id`, and `source`, with `turn_id` omitted on SessionStart. Its documented output includes a separate `systemMessage`, capped at 1000 characters, which renders to the user, not to model context, matching the Claude preference in this section. Its timeout is documented in seconds, not milliseconds. What Phase 0 must confirm live is the installed-version behaviour: the trust prompt flow for a project hook, what `systemMessage` rendering actually looks like, and that a 20 s equivalent does not block session start. If the installed version does not fire SessionStart as documented, the minimum port falls back to lazy daemon startup on first UserPromptSubmit  -  which works (the query hook already restarts a down daemon in the background) but loses the warm-model and first-run-onboarding behaviour, and the demo must say so honestly.

### 3.2 UserPromptSubmit  -  the injection pair (the demo's core)

This is the only hook pair the minimum shippable port *must* get working. Everything else is above the line.

#### 3.2a Query hook  -  `scripts/query-hook.js`, 10 s

**What it does:**

- Reads `{prompt, cwd}` from stdin. Empty prompt → `{continue: true}` immediately.
- Computes `projectId = sha256(abs cwd)[0:12]`.
- Reads context-window stats written by the statusline (see §6): `~/.contextus/runtime/<sessionId>.context-stats.json`, keyed by `CLAUDE_CODE_SESSION_ID` from the environment. Best-effort; missing file → `undefined`, not an error.
- POSTs to the daemon: `{prompt, project, cwd, contextStats, sessionId}` (sessionId from `CLAUDE_CODE_SESSION_ID`), with a 10 s abort timeout matching the hook timeout.
- Passes the daemon's response straight through to Claude Code  -  "The daemon already returns the exact hook output shape, so this stays a pure relay."
- On non-OK response, daemon-down, or slow fetch: background restart via `ensureDaemonRunning()`, emit `{continue: true}`.

**Stdout it emits:** exactly what the daemon returned, which for a successful inject is:

```json
{ "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "[contextus  -  relevant project context]\n…chunks…\n…provenance footer…" } }
```

For a capacity-disabled case (>85%, §6), the same shape carries the warning block instead of chunks. For a near miss, `additionalContext` carries the retrieval-gap notice. For a plain miss or any failure, `{continue: true}` with no `hookSpecificOutput`.

**Muse Code equivalent: DOCUMENTED, NOT LIVE-VERIFIED (§8.0)  -  this is still the Phase 0 spike, but the spike is now confirmation, not discovery.** The documented contract is:

- UserPromptSubmit is a documented Muse event, with no matcher other than `*`.
- Stdin is one JSON object, snake_case, stream then closed, not delivered if over 256 KiB. Fields include `hook_event_name`, `session_id`, `turn_id`, `cwd`, `transcript_path`, `model`, `permission_mode`, plus `prompt` on UserPromptSubmit. That gives the adapter `cwd` for the project hash and `session_id` for the §6 capacity key, in the payload, not from a Claude-style env var.
- Stdout injection is the documented JSON form `hookSpecificOutput` with `hookEventName` and `additionalContext`, under a closed camelCase schema: a wrong or unknown key rejects the whole answer. Plain stdout is added to model context on UserPromptSubmit. Exit 0 is success; exit 2 with stderr text blocks on blockable events; any other exit is treated as hook failure and the session continues as if the hook had not run. Adapter detail: snake_case in, camelCase out. Do not send the Claude shape verbatim, including a top-level `continue`, without testing it against that closed schema first.
- Size ceilings are documented at 16 KiB each for stdout and stderr. The build plan's 14 KB `additionalContext` ceiling is not in the §8.0 docs as excerpted, so it stays live-unverified.
- Timeouts are documented in seconds, default 600, not milliseconds.

What Phase 0 must confirm live, because the docs leave it open or version-dependent, is: what `transcript_path` and `model` actually carry in a real session (docs examples show `transcript_path` as null and `model` as unknown), what actually survives, truncates, or errors at and above the documented 16 KiB cap, what happens on timeout expiry (kill, warn, continue), and whether the documented shape actually lands in model context on the installed version.

**Minimum-port exit criterion (from the build plan, restated):** one real injection landing visibly in a Muse Code session, from the real daemon, against a real corpus. Not a mocked injection, not a pasted block, not a skill that prints context on demand  -  push injection on prompt submit, or the spike has not passed.

#### 3.2b Awareness hook  -  `scripts/awareness-hook.js`, 5 s

**What it does  -  capture, not injection:**

- Runs second on the same UserPromptSubmit slot, after the query hook.
- Asks the daemon `GET /novelty` for recently injected filenames, so the footer can say "you already have patterns on X, Y, Z  -  only propose if the insight isn't covered there." This is the novelty signal: capture informed by what retrieval already surfaced.
- Loads `prompts/awareness-footer.txt` (or `prompts/staging-footer.txt` in staging mode), with an inline fallback if the files are missing.
- Reads capture config with precedence: project `.claude/contextus.jsonc` wins over `plugin.jsonc` defaults. Modes: `propose` (default), `staging`, `silent` (footer suppressed entirely).
- Always emits its footer via `additionalContext`, never blocks the prompt.

**Why it matters for the port:** it is the second writer to the same `additionalContext` channel on the same event. If Muse Code's injection channel is single-writer, last-writer-wins, or size-capped across both hooks, the query injection and the awareness footer will collide  -  and the collision will look like "injection doesn't work" or "the footer overwrote the context". Phase 0 must test the two hooks *together*, not just the query hook alone, and must test what happens when both emit in the same turn.

**Muse Code equivalent: DOCUMENTED CHANNEL, LIVE-UNVERIFIED COMBINED BEHAVIOUR**, same contract as §3.2a, plus one live question: does Muse Code even have a capture-footer concept beyond the documented `additionalContext` channel, or does capture prompting have to move to a different mechanism (a skill the user invokes, a Stop-time summary, etc.)? The two-hook case is live-unverified: whether both the query hook and the awareness footer survive on the same UserPromptSubmit event, whether one overwrites the other, and whether there is a combined size limit across both. If the footer channel does not work in practice, the minimum port can ship query-only injection and defer the awareness footer  -  but then the capture loop is broken, and the demo/write-up must say the loop is half-ported, not imply full parity.

### 3.3 PostToolUse  -  `scripts/watch-contexts.js`, 8 s, matcher `Write|Edit|MultiEdit|NotebookEdit`

**What it does:**

- Event-driven incremental re-embed, *not* an fs.watch poller (the header explains why pollers were rejected: missed events on some FUSE/network mounts, double-fire on others).
- Pulls the edited file path from the payload: `payload.tool_input ?? payload.toolInput ?? {}`, then `file_path` (Write/Edit/MultiEdit), `notebook_path` (NotebookEdit), or `path` as fallback. Returns null when no path is present (e.g. a Bash call  -  nothing to re-embed).
- Only `.md` files are notified at all. Which *directory* counts as a source is deliberately **not** hardcoded here  -  an earlier version only recognised `.claude/context/` and missed `docs/` edits (corpus issue #22). The daemon's `/notify` handler owns routing against the merged per-project source config and returns a cheap `not_in_any_source` no-op for anything outside it.
- POSTs the touched file to the daemon's `/notify` for single-file re-embed (which skips unchanged content).
- Always emits `{continue: true}`. Re-embed failure never blocks the tool result. Daemon down → background respawn; the file is picked up by the next full embed or edit.

**Stdin it actually reads:** `tool_input`/`toolInput` (nested tool args), `cwd`. **Tool names it matches:** the hooks.json matcher string `Write|Edit|MultiEdit|NotebookEdit`  -  these are Claude Code tool names.

**Muse Code equivalent: LIVE-UNVERIFIED, not in the §8.0 documented excerpt.** The §8.0 docs document SessionStart and UserPromptSubmit in detail, and note a full catalog of 17 events on one page plus SessionFork and ToolUseStart as observation-only in the payload reference, but that excerpt does not document a PostToolUse equivalent, its tool names, or its edited-path payload shape. Phase 0 must answer live: does Muse Code have a post-tool-use hook, what are its tool names (same strings, or different, for example namespaced, or file-operation names that do not map 1:1), and what payload shape carries the edited path? If Muse Code has no post-tool hook, the daemon's own `fs.watch` backstop (§2.1) still catches outside edits, but with latency and without the sub-second fast path  -  and the port's capture freshness claim must be downgraded accordingly. This hook is in the build plan's cut order (cut before SessionStart/UserPromptSubmit parity), which is the right priority: it is valuable, not demo-critical.

### 3.4 Stop  -  `scripts/stop-evaluation.js` + `scripts/capture-gate-hook.js`, 5 s each

Two hooks share the Stop slot. They are different in kind, and the port must not conflate them.

#### Stop hook 1: `stop-evaluation.js`  -  usage signal + calibration queue

- Fires after the model finishes a response. **Non-blocking, near-zero cost: it does NO model call.**
- Always: parses the `Context: used:` footer from the response and logs a `usage_signal` event to `~/.contextus/logs/usage.jsonl`. This is the headline metric: "context was used in XX% of responses where it was injected."
- Calibration only: if a calibration campaign is active (`~/.contextus/calibration-state.json`), enqueues the full turn (thinking + response + injected patterns) to `~/.contextus/.eval-queue.jsonl` for Haiku grading (see the calibrate skill, §5).
- Reads the transcript: `payload.transcript_path` (from stdin) and `payload.cwd`. The header notes a real timing gotcha recorded in the corpus: the Stop hook can fire *before* the transcript write completes, so the response may not yet be on disk when the hook reads it.
- Reads `plugin.jsonc` by walking up from `CLAUDE_PLUGIN_ROOT` (env) or cwd, up to 5 levels.
- **Always emits nothing on stdout**  -  "Stop hooks don't need to return JSON." This is a Claude Code contract detail. A Muse port must not assume the same; if Muse Code *requires* stdout on Stop, emitting nothing may error or be treated as failure, and if it *forbids* stdout, emitting `{continue: true}` may pollute the turn.

There is also a legacy `hooks/stop-evaluation.js` in the repo (using `~/.contextus/config.json`, `.session-state.json`, `usage.jsonl` directly). The live hook is `scripts/stop-evaluation.js`; do not port the legacy copy by mistake. The existence of two copies is itself a review finding: the repo has a stale duplicate that a careless port could pick up.

#### Stop hook 2: `capture-gate-hook.js`  -  capture enforcement, prototype, off by default

- The "teeth" for the capture loop: the UserPromptSubmit nudge is soft and a live task always wins against it, so nothing stops a turn ending without a capture call. This hook adds enforcement for one cheaply-detectable case: a `git commit` ran this turn with no capture logged since the turn began.
- Deliberately conservative: **off by default** (`config.contextCapture.stopGate` must be true, opt-in per project); only fires on a `git commit` Bash call, not on Edit/Write generally; honours Claude Code's `stop_hook_active` loop guard (if it already blocked once for this stop cycle, it does not block again  -  one nudge, not an infinite loop; on retry it logs "captured after nudge" vs "nudged but it did not" as the miss-rate metric); respects an explicit `Context: capture-skip: <reason>` acknowledgment.
- Reads: `payload.cwd`, `payload.transcript_path`, `payload.stop_hook_active`; extracts the last turn from the transcript (tool uses, response text, turn start timestamp) via `scripts/lib/capture-gate.js`; writes a one-shot pending marker to `~/.contextus/.capture-gate-pending-<project>.json` when it blocks (deleted on retry  -  the marker exists precisely because the commit cannot be re-derived from the transcript on retry).
- Emits a block (with the capture prompt) when it fires, otherwise nothing / continue.

**Muse Code equivalent: LIVE-UNVERIFIED, and higher-risk than the others.** The documented §8.0 contract gives a `transcript_path` field on the UserPromptSubmit payload and a SessionEnd event, but the §8.0 excerpt does not document a Stop hook, its transcript timing, or a loop guard equivalent to `stop_hook_active`. Both Stop hooks depend on (a) a transcript file path, (b) transcript *timing* (written before the hook reads it), and (c) a loop guard. If Muse Code has no Stop hook, no usable transcript path, or no loop guard, the usage-signal metric and the capture gate both have no home  -  and the capture gate, which can *block* a turn, must not be ported into a host where blocking semantics are live-unverified. The documented blocking mechanism is exit 2 with stderr text on blockable events (§8.0), but whether Stop is a blockable event at all is live-unverified. **Recommendation for review: the capture gate is the first Stop hook to cut, and the last to port.** Ship Stop-evaluation (or a log-only equivalent) first; port the gate only after Muse Code's Stop semantics are proven live, and keep it off by default either way.

---

## 4. Config translation

Two files are routinely confused. They are not the same thing, and the port must keep them distinct:

| File | Role | Porting consequence |
|---|---|---|
| `.claude-plugin/plugin.json` (in the review copy, under `.claude-plugin/`) | **Install manifest.** Name `contextus`, description, version `0.20.0`, author. This is what a marketplace install reads. | Muse Code needs its own manifest format and location. **DOCUMENTED, NOT LIVE-VERIFIED in a Contextus install yet:** native manifest is `.muse-plugin/plugin.json`, see §4.4. Do not write a `.muse-plugin` file by guessing its schema  -  use the §4.4 schema, then validate it with `muse plugins validate` in Phase 0. |
| `plugin.jsonc` (repo root) | **Runtime config.** The code reads its `config` block via `findPluginJson()` (`lib/config.ts`). The header comment in the file itself says so, explicitly: "RUNTIME CONFIG, not the plugin manifest… Two files on purpose." | This is the file the port actually translates. Its values are the ones in play; its *location and name* may need a Muse equivalent, but its *contents* are host-independent tuning. |

### 4.1 Config precedence  -  `lib/config.ts`

`loadProjectConfig(project, cwd)` merges, in increasing precedence:

1. Code defaults (permissive: floor 0.35, expansion threshold 0.55 in the current code  -  see the injection-flow doc).
2. `plugin.jsonc` `config` block.
3. Per-project stored config (`~/.contextus/data/<project>/config.json` in the injection-flow doc's account; the code path is via `loadProjectConfig`).
4. Git-committed project override `.claude/contextus.jsonc`  -  **wins**.

The Muse port must preserve this precedence, or at least document where it diverges. A port that reads only the plugin file and ignores the project override will silently ignore the tuning a project actually ships with  -  and the demo corpus's tuning, if any, lives in the project override.

### 4.2 The values actually in play  -  `plugin.jsonc` `config`

**Sources** (see §2.3 for paths):

- `projectContext`: `.claude/context`, index `CONTEXT.md`, exclude `CONTEXT.md`, `README.md`, `.archive/**`.
- `projectDocs`: `docs`, index `DOCS.md`, exclude `DOCS.md`, `README.md`.
- `userContext`: `~/.contextus/context`, index `CONTEXT.md`, same archive exclude.
- `userDocs`: `~/.contextus/docs`, index `DOCS.md`.

**LanceDB:** `mode: file`, `path: ~/.contextus/data/{project-name}`. One shared DB with a project-hash column (corpus decision: unified DB, workspaces for bidirectional sharing), not one DB per project. The port does not change storage layout.

**Embedding:** provider `ollama` (deployed default  -  the comment explains why: the corporate Cloudflare Gateway blocks Hugging Face downloads, so Ollama runs the same nomic model locally over localhost; the *design* default in DESIGN.md is `transformers`, in-process ONNX), model `nomic-ai/nomic-embed-text-v1.5` / Ollama `nomic-embed-text`, **768 dims**, batch 32. Transformers options (`localModelPath`, `cacheDir`, `remoteHost: https://huggingface.co/`, `allowRemoteModels`) matter only if the provider flips. **Porting note:** switching embedding provider/model is a full re-embed, not a config flip, and re-embedding alone does not fix the hardcoded nomic `search_query:` task-prefix assumption, which silently degrades quality on non-nomic models with no error (corpus gotcha). The Muse port must not swap the embedder "because Muse has a better one" without a re-embed plan and a prefix audit.

**Retrieval (the values in play, not the code defaults):**

- `topK: 5`
- `injectionFloor: 0.725`  -  **stale comment warning:** the `plugin.jsonc` comment still says the floor was "calibrated to 0.45 via /context-calibrate --floor against 721-chunk corpus" while the value is 0.725. Do not quote the comment as the value.
- `similarityThreshold: 0.7`  -  a separate post-ranking filter, not the injection gate. Do not conflate the two.
- `maxTokens: 3000`
- `mergeStrategy: interleaved`
- `hybrid: adaptive` (see §2.2 for what adaptive means and its cap quirk).

**Expansion:**

- `mode: adaptive`, provider `ollama`, model `qwen2.5:3b`, fallback provider `bedrock`, fallback model `us.anthropic.claude-haiku-4-5-20251001-v1:0`, `expansionThreshold: 0.775`, `maxVariants: 3`, `temperature: 0.7`, `timeoutMs: 5000`.
- **Porting note:** the Bedrock Haiku fallback is an Anthropic-model dependency inside a Meta-host port. It is a fallback, not the primary, and it only fires on fast primary failure  -  but a Muse submission that silently calls Bedrock Haiku should disclose that, and Phase 0 should test whether the fallback path is even reachable/desirable on a machine without Bedrock credentials. The primary (local Ollama) path is the portable one.

**Capture:** `contextCapture.mode: staging` in the deployed config (the awareness hook's default in code is `propose`  -  config wins; see §3.2b), `captureFooter: always`, `stopGate` off by default (prototype, §3.4).

**Providers block:** `ollama.endpoint: http://localhost:11434`, `bedrock.region: us-east-1`, `anthropic: {}` (empty  -  no key baked in). No secrets live in `plugin.jsonc`. The port must keep it that way.

### 4.3 Meta AI provider  -  the contest key, added 2026-10-26 as pre-contest planning

Added at Anthony's direction 2026-10-26, before the window, as pre-contest planning, not as in-window work.

Anthony's point, agreed: a real key to this contest and this port is to allow configuring use of the Meta AI API anywhere Contextus uses an AI, not just in the hook adapter. A port that only adapts hooks, but still calls Ollama for expansion and Bedrock Haiku for grading, is a Claude port with a Muse adapter, not a Meta port. Judging gives 25% to Meta AI Tooling, so this section matters more than a nice-to-have.

**Current provider registry, verified in the review copy:**

- `LLMProviderType` in `lib/config.ts`: `'ollama' | 'anthropic' | 'bedrock'`. No Meta provider exists yet.
- `EmbeddingProviderType` in `lib/config.ts`: `'transformers' | 'ollama'`. No Meta embedding provider exists yet, and none was found in Meta Model API listings checked 2026-10-26, which serve Spark and Wonder chat models and voice transcription, not a dedicated embedding model.

**AI touchpoints to make Meta-configurable, per touchpoint, not globally on or off:**

- **Query expansion** (`lib/retrieval/expand.ts`, §4.2): today Ollama qwen2.5:3b, fallback Bedrock Haiku, 5 s timeout, 3 variants, threshold 0.775. This is the best first Meta job: it is in the hot path, it is a phrasing task Spark does well, and Contributor rates make it cheap.
- **Calibration grading** (`lib/calibration/eval-model.ts`, `context-calibrate --campaign`, eval worker, stop evaluation): today Bedrock Haiku by default, with Ollama and Anthropic as alternatives. Grading injections, floor replay, and usage campaigns should all be able to point at Meta instead.
- **LLM-assisted maintenance skills:** `context-merge` (Haiku reads both files), `context-tag --suggest`, and any other skill that calls an LLM for merging, tagging, or review. Same registry, same config.
- **Transcript mining and capture summarisation, where an LLM is used:** same registry, so a user can point all of them at Meta, or mix providers by touchpoint.

**Design, not a hard switch:**

- Add a `'meta'` provider to the LLM registry, alongside Ollama, Anthropic, and Bedrock, with a `providers.meta` config block: API key from env, never baked into `plugin.jsonc`, and, optionally per capability, a provider plus model pair (for example expansion on Meta Spark Contributor, merge on Meta Wonder, grading on Bedrock Haiku), with a fallback chain and a global default when a capability does not specify one.
- Default for bulk work: Spark, on Contributor where the user has accepted that trade, $0.10/M input, $0.20/M output in the rates checked 2026-10-25. Wonder, $4/M input, $20/M output, is an opt-in for hard grading, not a default, or it will burn the $150 credits fast.
- Keep Ollama and Bedrock as fallbacks, not removed. A Muse port that cannot run offline, or on a machine without a Meta key, is weaker than the Claude version, not stronger.
- **Embeddings stay local, honestly:** nomic via Ollama or Transformers, 768 dims, with the re-embed and `search_query:` prefix audit in §4.2 still applying. There is no Meta embedding model to switch to, so claiming "embeddings now use Meta" would be false. Local embeddings also keep the local-first story intact.
- **Cost control is part of the provider, not an afterthought:** the $150 Meta credits, claimed via a form 2026-10-26, are distributed in batches, require a credit card on file to use at all, and the Billing page offers a Spend Limit *notification*, not necessarily a hard cap. The Meta provider config should surface model, estimated cost per call, and fallback behaviour, so a user does not silently burn credits on Wonder grading.

**Phase 0 test for this section, to add to §8.7:**

- [ ] A Meta provider call succeeds from the daemon, for expansion, with a Spark model, and the result is logged with provider and model, not just "expansion succeeded".
- [ ] The same call fails open to the configured fallback (Ollama or Bedrock) when the Meta key is absent or the API errors, with the same fail-open behaviour as the rest of the daemon.
- [ ] Calibration grading can be pointed at Meta independently of expansion, so a user can use Spark for expansion and a different model for grading, or vice versa, without changing code.

### 4.4 Plugin directory structure - Muse Code, documented 2026-10-26

Added 2026-10-26 at Anthony's request, as pre-contest planning reference, from Muse Code SDK docs 1.4 (checked against Muse Code 1.3.0 in those docs). Not yet live-verified by installing Contextus itself in Muse Code - Phase 0 must run `muse plugins validate`, `muse plugins install`, and `muse plugins approve` on a real Contextus package before claiming this works.

**Native Muse plugin directory:**

```
my-plugin/
  .muse-plugin/
    plugin.json
  skills/
    forecast/
      SKILL.md
  commands/
    forecast-brief.md
  hooks/
    log-tool-use.sh
```

**Native manifest, `.muse-plugin/plugin.json`:** UTF-8 JSON, max 128 KiB, at the root of the plugin directory. Example from the docs, the weather plugin, which declares one skill, one command, and one hook and validates clean:

```json
{
  "schemaVersion": 1,
  "name": "weather",
  "displayName": "Weather",
  "version": "0.1.0",
  "description": "Example plugin: a forecast skill, a forecast-brief command, and a hook that logs tool use.",
  "compat": {
    "source": "native",
    "manifestDir": ".muse-plugin"
  },
  "capabilities": {
    "skills": [
      { "id": "forecast", "path": "skills/forecast/SKILL.md", "enabledDefault": true }
    ],
    "commands": [
      { "id": "forecast-brief", "path": "commands/forecast-brief.md", "enabledDefault": true }
    ],
    "hooks": [
      {
        "id": "log-tool-use",
        "event": "PostToolUse",
        "command": ["sh", "hooks/log-tool-use.sh"],
        "timeoutMs": 5000,
        "statusMessage": "Logging tool use"
      }
    ],
    "mcpServers": [],
    "reminders": []
  }
}
```

**Capability families, and what needs review:**

- `skills`: `{id, path, enabledDefault?}`. Invoked as `/<id>` or `/<plugin-id>:<id>`. Path must be a `SKILL.md` file, relative to plugin root, `/` separators, no absolute paths, no `..`, resolved file stays inside plugin root.
- `commands`: `{id, path, enabledDefault?}`. Markdown template, only `description` and `argument-hint` frontmatter are read, `$ARGUMENTS` is replaced by user input.
- `hooks`: `{id, event, command, timeoutMs?, statusMessage?, async?, compatibilityName?, outputCapabilities?}`. Argv array, no shell, no `matcher` field (a `matcher` entry fails validation), event spelled in PascalCase, `timeoutMs` default 600000 ms. Hooks need review before they run.
- `mcpServers`: `{id, transport?, command? or url}`. Stdio or http, no `env` / `headers` / credential fields in a native entry.
- `reminders`: advanced, used mainly by built-in plugins.

Skills and commands work as soon as the plugin is installed and enabled. Hooks, MCP servers, and reminders stay inactive until `muse plugins approve` - installing a plugin never activates its hooks. Approval is bound to a hash of the hook definition and the installed package; any change to the package returns a hook to `modified` status until approved again. Hooks are wired when a session starts, so approval takes effect in the next session.

**Package limits, documented:**

- Manifest: 128 KiB. Package entries: 4,096 files/directories, excluding VCS metadata. Directory nesting below package root: 16 levels. Symlink entries: none allowed, install refuses a package with any symlink entry, even one staying inside the package. `SKILL.md`: 256 KiB, larger files are not loaded by the skill catalog. Keep `node_modules`, virtual environments, and build output out of the plugin directory.

**Claude-compatible import, and single-copy skills:**

Muse Code also recognises `.claude-plugin/plugin.json`, labelled `claude-compatible`. Without a `skills` key it scans `skills/` recursively for `SKILL.md`; skill id is frontmatter `name`, else directory name. Commands come from `commands/` unless a `commands` key lists paths. Hooks come from manifest `hooks` plus conventional `hooks/hooks.json`; all 17 events are accepted, `PreUserTurn` is an alias for `UserPromptSubmit`. Claude plugin skills that declare `allowed-tools` show a not-yet-enforced compatibility row, plugin status `partial`; a malformed `allowed-tools` value rejects the plugin.

Manifest precedence, one per package, never fallback if the chosen one is invalid: `.muse-plugin` over `.claude-plugin` over `.codex-plugin`, with a `multiple-manifests` warning naming the ignored files. The docs state this precedence "makes it safe to ship a native manifest next to a Claude Code one so that both hosts can install the same directory."

Design consequence for Contextus, agreed 2026-10-26: **do not keep two copies of each skill.** Keep one generic copy per skill in `skills/<name>/SKILL.md`, and point both manifests at that same file - `.claude-plugin/plugin.json` for Claude, `.muse-plugin/plugin.json` with `capabilities.skills[].path: "skills/<name>/SKILL.md"` for Muse. Linking is for a personal install into `$HOME/.claude/skills` or `$HOME/.agents`, not for the package itself, which must not contain symlinks.

**Install / validate / approve flow, to test in Phase 0:**

- `muse plugins validate <plugin-dir>` - reports `valid <id> native|claude-compatible skills=N commands=N hooks=N mcp=N reminders=N diagnostics=N`, with `partial` summary for Claude-compatible packages with unsupported declarations.
- `muse plugins install <plugin-dir>` - installs, skills/commands active, hooks/MCP in `review_needed`.
- `muse plugins inspect <plugin-id>` - lists runtime capabilities and review status.
- `muse plugins approve <plugin-id>` or `muse plugins approve <plugin-id>:hook:<hook-id>` - approves hooks, effective next session.
- `muse plugins hook test <plugin-id>:<hook-id> --fixture fixture.json` - tests one hook outside a session.
- `muse skills validate <skill-dir>` - checks `SKILL.md` frontmatter, which the manifest validator does not parse.

**Engines:** `plugin.jsonc` says `claude: ">=1.0.0"`, `node: ">=22.0.0"`; `package.json` says `node: ">=22.0.0"`. A Muse manifest, when it exists, will need its own engines field  -  **LIVE-UNVERIFIED** what Muse Code requires or accepts. Do not copy `claude: ">=1.0.0"` into a Muse file and assume it is ignored.

**`dist/` committed:** see §2.1. The port keeps `dist/` committed unless Muse Code's plugin loading forbids committed build output or requires a build step  -  another live-unverified Phase 0 question, not a decision to make in this doc.

---

## 5. Skills  -  24 directories, one anomaly, and a core subset

The review copy contains **24 skill directories** under `skills/` (not 25, not 26  -  counted from the directory listing; earlier estimates of 25/26 included either the `ctx` dispatcher counted twice or a planned skill). Each has a `SKILL.md` with `name` + `description` frontmatter. One-line purposes, from those frontmatter lines verbatim in substance:

| Skill | Purpose |
|---|---|
| `add-patterns` | Bulk import patterns from external sources (JSON, CSV, directory scan). Validates, dedupes, embeds. **Marked "Future feature" in its own description.** |
| `configure` | View/edit project config (`.claude/contextus.jsonc`)  -  sources, excludes, retrieval tuning, docs, capture mode. The single entry point for config changes. |
| `context-archive` | Archive low-value patterns to `.claude/context/.archive/` (bulk `--stale`/`--unused` or single). Removes from LanceDB, preserves file content. |
| `context-audit` | Corpus quality audit: structural issues, staleness (6+ months unmodified), usage patterns (never retrieved). Health check with suggested fixes. |
| `context-calibrate` | Quality measurement: `--floor` (replay real transcript prompts, recommend a floor, no usage history needed) and `--campaign` (after 1-2 weeks, Haiku grading campaign over real injections, refine thresholds). Proves whether contextus is working. |
| `context-doctor` | Troubleshoot: daemon health, retrieval problems, DB corruption, config errors. |
| `context-merge` | Merge duplicate patterns, LLM-assisted (Haiku reads both files, detects overlap, generates a unified version; original kept, duplicate archived). |
| `context-review` | Curate corpus: archive noisy patterns, merge duplicates, flag for rewrite. |
| `context-search` | Search corpus by semantic similarity (the manual pull path; the daemon `/search` endpoint underneath). `--limit`, `--scores`. |
| `context-stats` | Usage analytics: what's working, what's noisy, what's stale. |
| `context-status` | Health dashboard: corpus stats, daemon health, recent embeddings, injection coverage, calibration quality. "The go-to diagnostic when something feels off." |
| `context-tag` | Manage tags: backfill missing (`--backfill`), AI-suggested improvements (`--suggest`), bulk update. |
| `contextus-setup` | Guided setup wizard: scaffold, configure, embed. Two tracks (quick/power user). First-run or re-configure. Anthony has called this one of the parts he is proudest of. |
| `contextus-upgrade` | Run after install/update: migrate config, database, linked projects to the new version. |
| `contextus-watch` | Live activity stream: coloured, formatted follower over `daemon.log` (retrievals, no-injects, errors, embeds in real time). "The 'what is contextus doing?' command." |
| `create-context` | Capture a new pattern/decision/implementation note into `.claude/context/` with validation, dedupe, frontmatter + body, auto-embed. |
| `create-doc` | Create documentation in `docs/` with the same frontmatter schema as context files. |
| `ctx` | Quick dispatcher: `/ctx status\|stats\|create\|calibrate\|doctor\|watch\|daemon\|setup\|link\|search\|review\|rebuild\|mine` (frontmatter list  -  see dispatcher gap below). |
| `link-project` | Link another project's context into this corpus; shared patterns rank at 0.85 (below own). Multi-repo workflows. |
| `manage-daemon` | Stop/start/restart the daemon (after config changes or when unhealthy). |
| `migrate-memory` | Convert legacy `.claude/memory/` to `.claude/context/` with typing, tags, retrieval-optimised frontmatter. **Slated for removal** ("migrate memory will be gone soon"  -  the legacy converter is separate from the migrations registry; do not build the port around it). |
| `mine-transcripts` | Mine past Claude Code session transcripts for patterns never captured live  -  the retrospective safety net. |
| `rebuild-embeddings` | Rebuild entire corpus: re-embed all context files, docs, user memory. |
| `update-context` | **ANOMALY  -  verified.** The directory is `update-context` and its body is about updating context (see `reference.md`), but its `SKILL.md` frontmatter reads `name: use-jest-for-testing`, `description: Always use Jest as test framework`. That frontmatter belongs to a completely different skill (a Jest-testing instruction). In Claude Code, skill discovery keys off frontmatter, so this skill as shipped is either undiscoverable under its real name, or discoverable under a wrong name with a wrong description. **Do not port this skill by copying its frontmatter.** Fix the frontmatter first (or drop the skill from the port subset), and treat the anomaly as evidence that skill frontmatter in this repo needs an audit before any host that keys off it  -  including Muse Code  -  is trusted with it. |

### 5.1 The `ctx` dispatcher gap  -  verified

The `ctx` SKILL.md frontmatter lists: `status|stats|create|calibrate|doctor|watch|daemon|setup|link|search|review|rebuild|mine`.

The body of the same file maps additional subcommands that the frontmatter omits: `tag`, `configure`, `upgrade`, `migrate`, `audit`, `archive`, `merge` (plus `watch`, `daemon`, etc. that are in both). If Muse Code  -  like Claude Code  -  uses frontmatter for skill routing/discovery, the omitted subcommands may not route, even though the body documents them. The port must either fix the frontmatter to list all mapped subcommands, or accept that `/ctx tag` etc. will not work and say so. This is a pre-existing repo issue, not a Muse invention, and it is exactly the kind of thing a "does Muse recognise Claude-style skill files?" Phase 0 test must check: does recognition mean "reads the file", "registers the frontmatter name/description", or "routes the subcommands"? Those are three different levels of recognition.

### 5.2 Core subset for a minimum port vs full parity

**Minimum port (demo + honest submission):** the injection loop does not need most skills. The subset that the demo actually depends on, directly or for diagnosis on camera, is:

- `contextus-setup` (first-run scaffolding for the demo corpus project  -  or, if setup is done by hand for the demo, this becomes a nice-to-have)
- `context-search` (the manual pull path; the near-miss notice itself tells the user to use it when drift occurs)
- `context-status` + `context-doctor` (diagnosis when injection does not appear  -  the two skills you reach for when something feels off)
- `create-context` (capture, so the loop is not retrieval-only)
- `ctx` (only if its frontmatter is fixed; otherwise it is a liability, not a shortcut)

**Full parity (above the line, cut first per the build plan):** everything else, in roughly this order of value: `context-calibrate` (proves the port works, but needs usage history  -  a `--floor` replay is feasible in-window, a `--campaign` is not, it needs 1-2 weeks), `context-stats`, `context-review`, `context-tag`, `context-archive`, `context-audit`, `context-merge`, `configure`, `manage-daemon`, `link-project`, `rebuild-embeddings`, `mine-transcripts`, `contextus-upgrade`, `contextus-watch`, `create-doc`, `add-patterns` (future feature  -  do not port a future feature as if it were shipped), `migrate-memory` (slated for removal  -  do not port it at all).

**Skill-format risk, stated plainly:** every skill body in this repo assumes Claude Code conventions  -  slash-command invocation (`/context-search`), Claude Code tool names, `.claude/` paths, and in several cases an eval model (Haiku) for grading/merging. A skill file that Muse Code "recognises" (reads and lists) is not the same as a skill file that Muse Code *executes correctly*. Phase 0 must test at least one skill end-to-end (setup or search are the best candidates: setup exercises scaffolding + embed, search exercises the daemon) before claiming "skills ported".

**LIVE-VERIFIED 2026-10-26, from running Muse Code settings (personal, not project, skills):** Muse Code automatically picks up personal skills from `$HOME/.claude/skills`, and also looks in `$HOME/.agents`. It says it will not use `CLAUDE.md`, only `AGENTS.md`. Design consequence, agreed 2026-10-26: make skills generic by default, not Claude-specific, then optionally link them into host-specific paths, rather than maintaining two copies. That also aligns with the §2.3 neutral `.contextus/` path: generic skill bodies, generic `AGENTS.md` stanza, host-specific linking as an install step, not a fork.

---

## 6. Statusline / window-capacity handling

This is the part of the system most likely to be silently lost in a port, because it is not a hook  -  it is a side channel.

**How it works in Claude Code:**

- A statusline script (installed via `scripts/install-statusline-bridge.sh`, with a debug variant in `install-debug-statusline.sh`) writes context-window stats to a per-session file: `~/.contextus/runtime/<sessionId>.context-stats.json`, where `<sessionId>` is `CLAUDE_CODE_SESSION_ID`.
- The query hook reads that file (best-effort) and forwards `contextStats: {input_tokens, output_tokens, used_percentage}` to the daemon's `/query`.
- The daemon's capacity guard (`daemon/server.ts`, "Token capacity guard (GitHub #17)", thresholds configurable via `cfg.capacityProtection` with defaults below) then adjusts retrieval *before* search:

| Used % | Behaviour |
|---|---|
| ≤70% | Normal: `topK` as configured (5), floor as configured (0.725). |
| >70% (`reduceAt`, default 70) | Reduced: `topK = min(configured topK, 3)`, floor unchanged. Tier `reduced`. |
| >80% (`minimalAt`, default 80) | Minimal: `topK = 1`, floor × 1.2 (effective 0.87 at floor 0.725). Tier `minimal`. |
| >85% (`disableAt`, default 85) | Disabled: no injection, but a warning block is emitted via `additionalContext` (`[contextus: conversation at X% capacity (YK tokens), injection disabled to prevent overflow]`), not silence. Tier `disabled`. |

- SessionStart cleans stale stats files (>24 h old) from `~/.contextus/runtime/`.
- The thresholds themselves are configurable (`disableAt`/`minimalAt`/`reduceAt` in `capacityProtection` config); the numbers above are the code defaults when config does not override them. A port that hardcodes 70/80/85 without reading `capacityProtection` would regress configurability.

**Why a Muse statusline equivalent is an open Phase 0 question:**

- Does Muse Code have a statusline at all? If so, does it expose token/window usage to a script, in what format, and can that script write a per-session file the query hook can read? Statusline existence and format are **live-unverified**; they are not in the §8.0 documented hook contract excerpt.
- Is there a Muse session-id equivalent to `CLAUDE_CODE_SESSION_ID` to key the stats file by? The documented hook payload already carries `session_id` (§8.0, documented, not live-verified in a real session), so the capacity key does not need a Claude-style env var, but whether a statusline script can access that same `session_id` is live-unverified. Without a stable per-session key, the stats file cannot be scoped to the right conversation, and the capacity guard will either read the wrong session's stats or none at all.
- If there is no statusline, the capacity guard degrades gracefully (no `contextStats` → no adjustment → normal injection), but it degrades *silently*: the port will inject at full topK into a nearly-full window, and the failure mode will be an API overflow error from the model provider, not a contextus warning. That is a real regression risk for long demo sessions, and the demo should either keep sessions short enough that capacity never matters, or prove a Muse-side capacity signal exists.
- The build plan's "statusline equivalent only if the token-usage gap cooperates" and its cut order (statusline receipts are cut before PostToolUse/Stop parity, log tail carries visibility alone) is the right priority. The log tail (`daemon.log`, via `contextus-watch` in full parity) is the fallback visibility channel  -  it does not need a statusline, and it is what the camera should capture if no Muse statusline exists.

---

## 7. Transport plan: MCP dual-door (plan, not implemented)

Anthony's plan, discussed 2026-10-25, not code in the review copy:

> Turn the daemon into an MCP server, **but still answer the same HTTP calls as well.** "It's just a different door to the same house." MCP for the model (a native pull tool), HTTP for system plumbing (hooks, statusline, skills).

Rationale, as discussed:

- The core pipeline is transport-agnostic. The port should be interface work, not a second pipeline.
- MCP gives the model a *native pull tool* (`/context-search` as a tool, not a skill that shells out to HTTP), which addresses the known pull-path weakness (agents do not consistently query; push injection helps but does not solve mid-turn drift).
- HTTP stays for everything that is not a model tool call: hooks firing on prompt/tool/stop events, the statusline bridge, skill scripts, daemon control.
- Both transports stay thin over the same core: same `/query` logic, same floor, same reranker, same corpus. If MCP and HTTP ever disagree on what injects, that is a bug, not a feature.

What this plan is **not**:

- It is not a replacement for push injection. Push (UserPromptSubmit hook → `additionalContext`) is the demo's core and the system's killer feature (zero-query injection, per the corpus positioning decision). MCP pull is the complement for mid-turn drift, not a substitute for the opening-prompt inject.
- It is not implemented in 0.20.0. There is no MCP server file in the review copy, no MCP tool definitions, and no MCP transport in `daemon/server.ts`. Any doc or submission that describes MCP support as shipped would be false.
- It is not a reason to drop HTTP. Dropping HTTP would break every hook in §3, which are HTTP clients. The dual-door only works if both doors stay open.

**Porting implication for review:** the minimum Muse port does not need MCP at all. It needs the HTTP door working through documented Muse hooks (§8.0), confirmed live. MCP is therefore not a fallback for a missing hook channel, because a hook channel is documented; MCP becomes relevant only as a Phase 2 addition after push injection is proven live, to close the mid-turn pull gap. Phase 0 must confirm the documented hooks live before MCP work is scheduled, not re-litigate whether hooks exist.

Related, for the mobile-device question Anthony raised separately (2026-10-25): with Claude, mobile driving goes through the **wdio MCP server** (WebDriverIO/Appium), not through Contextus. Muse's advertised browser/mobile-device use is a *separate* capability from Contextus memory, and how Muse drives a device (built-in computer-use/accessibility vs an MCP server like wdio) is its own Phase 0 question. Do not conflate "Muse can drive a device" with "Muse has Contextus memory"  -  they are different systems, and the port only covers the second.

---

## 8. Phase 0 test checklist  -  Oct 26-27 (the go/no-go)

Phase 0's job is not to build. It is to confirm, by experiment in a live Muse Code session, the contracts this doc marks DOCUMENTED, NOT LIVE-VERIFIED in §8.0, and to answer live the questions it marks LIVE-UNVERIFIED. Each item below is a test with a pass/fail observable, not a discussion topic. The go/no-go decision is Tue Oct 27 evening (build plan); if a fundamental item below fails, the plan's fallback applies  -  drop to the minimum line and shift demo weight to the diagnosis story  -  rather than spending the weekend fighting the platform.

### 8.0 Documented hook contract  -  found 2026-10-25, to confirm live in Phase 0

Added 2026-10-25 at Anthony's yes, after the in-session hook docs were found following the SDK redirect. This is documented, not live-verified: the docs site is labelled 1.4 (latest) but the hook pages say values were checked against Muse Code 1.3.0, so Phase 0 must still confirm every item below in a live session. It narrows Phase 0 from "does any of this exist?" to "confirm these documented contracts".

Sources, verbatim:
- https://meta-models.github.io/muse-code-sdk/1.4/guides/extend/hooks/
- https://meta-models.github.io/muse-code-sdk/1.4/guides/plugins/reference/hook-events/
- https://dev.meta.ai/docs/muse-code/extending

- [ ] Config: user hooks in the `hooks` member of `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`), which must include `schema_version 1` or the file is rejected; project hooks in `<project-root>/.muse/hooks.json`; managed hooks from the file named by `managed_hooks_path` in settings. Loaded at session start, managed, then user, then project; edits take effect at the next session, not the running one. Confirm this exact layout in the installed version, and record where the adapter's `muse-hooks.json` equivalent actually lives.
- [ ] Events, documented: SessionStart, matched on `source`: startup, resume, clear, compact, fork; and UserPromptSubmit, no matcher other than `*`. Confirm the full event catalog live: one page lists 17 events, the payload reference additionally lists SessionFork and ToolUseStart as observation-only. Treat the catalog as version/page-dependent until tested.
- [ ] Input: one JSON object on stdin, stream then closed, not delivered if over 256 KiB. Keys are snake_case: `hook_event_name`, `session_id`, `turn_id` (omitted on SessionStart/SessionEnd), `cwd`, `transcript_path`, `model`, `permission_mode`, plus `source` on SessionStart and `prompt` on UserPromptSubmit. Confirm live what `transcript_path` and `model` actually carry: docs examples show `transcript_path` as null and `model` as unknown.
- [ ] Output: exit code first, then stdout. Exit 0 is success; plain (non-JSON) stdout is added to model context on SessionStart, SubagentStart and UserPromptSubmit and ignored elsewhere; exit 2 with stderr text blocks on blockable events (for UserPromptSubmit, the prompt is rejected); any other exit is treated as hook failure and the session continues as if the hook had not run. JSON injection form is `hookSpecificOutput` with `hookEventName` equal to the event that ran and `additionalContext` as the injected text. The output schema is closed and camelCase: a wrong or unknown key rejects the whole answer. **Adapter detail: snake_case in, camelCase out.** Do not carry Claude's output shape over without this translation.
- [ ] `systemMessage` is a separate output, capped at 1000 characters. This is the daemon-announcement channel: it renders to the user, not to model context, which matches the porting doc's existing preference for announcing daemon state visibly without polluting context (§3.1). Confirm the cap and the rendering live.
- [ ] Size ceilings, documented not live-verified: stdout and stderr each capped at 16 KiB per the docs. This documents the 16 KiB figure the earlier build plan asserted, but does not live-verify it. §8.3's size-ramp test (1 KB, 4 KB, 14 KB, 16 KB, 32 KB, 64 KB) still applies, to measure what actually survives, truncates, or errors in the installed version.
- [ ] Timeouts, documented: hook timeout is in seconds, default 600, NOT milliseconds. The Claude-side millisecond timeouts in this doc (e.g. query 10 s = 10000 ms in Claude's `hooks.json`) cannot be carried over literally. §8.3 must test timeout units and expiry behaviour, and the adapter must emit seconds.
- [ ] Trust, correcting the earlier caveat in this doc and in chat: project hooks run only after the project folder is trusted (terminal trust prompt, or `--trust-workspace` for `muse exec`); user hooks need no separate hook-level trust step; managed hooks likewise need no project-trust step. There is no `muse hooks` trust/approval command for settings-level hooks: that is a plugin-hooks concept, not a settings-hooks one. This aligns with the setup-time expectation: trust is handled once during setup (§3, setup wizard), not per prompt. Confirm the trust prompt flow live, for both a project hook and a user hook.
- [ ] In-session hooks are distinct from the external SDK: `muse serve` / `muse schema` drive Muse Code from another program; they do not configure hooks, though a serve session fires hooks already configured in a session. Do not confuse the SDK protocol with the in-session hook contract above.

### 8.1 Confirm documented command hooks live

Documented, not live-verified: Muse Code supports command hooks, configured as user hooks in the `hooks` member of `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`, with `schema_version 1` required), project hooks in `<project-root>/.muse/hooks.json`, and managed hooks from the file named by `managed_hooks_path`. Load order is managed, then user, then project, at session start.

- [ ] Create a trivial hook (e.g. a script that writes a marker file, or emits a known string) on UserPromptSubmit, using the documented project hooks path. Send a prompt. **Pass:** marker/string appears. **Fail:** no hook runs, or the installed version does not honour the documented path.
- [ ] Confirm the documented config paths and load order live, and record where the adapter's hooks actually live on the installed version  -  do not assume they mirror `hooks/hooks.json`.
- [ ] Confirm hooks are per-project as well as per-user: project hooks give Contextus the per-project scope it needs (corpus is per-project, keyed by cwd hash), with user hooks as the fallback.

### 8.2 Confirm the prompt-submit payload and injection stdout contract live

Documented, not live-verified: stdin is snake_case (`hook_event_name`, `session_id`, `turn_id`, `cwd`, `transcript_path`, `model`, `permission_mode`, plus `prompt` on UserPromptSubmit), and stdout injection is the closed camelCase JSON form `hookSpecificOutput` with `hookEventName` and `additionalContext` (§8.0).

- [ ] Log the full stdin payload Muse Code passes to a prompt-submit hook. Record every field name verbatim and compare against the documented list above, not against Claude Code's `{prompt, cwd}` + `CLAUDE_CODE_SESSION_ID` env. **Do not map by analogy; map by observed field names, and note what `transcript_path` and `model` actually carry, since docs examples show them as null and unknown.**
- [ ] Send back the documented Muse shape (`hookSpecificOutput: {hookEventName, additionalContext}`), not the Claude shape verbatim: the Claude shape adds a top-level `continue`, which the documented closed schema may reject as an unknown key. **Pass:** injected text appears in the model's context and is visibly used. **Fail modes to distinguish:** silently dropped, rendered to the user but not to the model, error, or session blocked.
- [ ] If the documented shape fails live, try the plausible alternatives one at a time (system message? tool result? a memory-file write?) and record which, if any, actually injects into model context. A channel that renders to the user is not injection.
- [ ] Test the two-hook case: query hook + awareness footer on the same event. Do both survive? Does one overwrite the other? Is there a combined size limit across both?

### 8.3 Timeouts and size ceilings  -  confirm documented figures live

- [ ] Timeout behaviour: timeouts are documented in seconds, default 600 (§8.0), not milliseconds. Set a hook timeout, make the hook sleep past it, and observe. What happens on expiry  -  killed, warned, or continued?
- [ ] Stdout ceiling: stdout and stderr are documented at 16 KiB each (§8.0). Send injections of increasing size (e.g. 1 KB, 4 KB, 14 KB, 16 KB, 32 KB, 64 KB) and record what survives intact, what truncates, and what errors in practice on the installed version. The build plan's 14 KB figure is not in the §8.0 docs as excerpted, so it stays live-unverified and is not a documented ceiling. If there is no ceiling in practice, record that too  -  it changes the daemon's truncation seam (§2.4) from required to optional.
- [ ] Hook ordering: if multiple hooks share an event, is order deterministic? Does the query hook reliably run before the awareness hook, or is order unspecified?

### 8.4 Skills recognition  -  three levels, test each

- [ ] Level 1 (reads): does Muse Code list a Claude-style `SKILL.md` (frontmatter `name` + `description` + body) as an available skill?
- [ ] Level 2 (routes): does invoking `/context-search` (or the Muse equivalent syntax  -  **LIVE-UNVERIFIED** what the invocation syntax is; it is not in the §8.0 hook docs excerpt) actually run that skill's instructions?
- [ ] Level 3 (executes): does a skill that shells out to the daemon (`/context-search` → `/search`, `/context-status` → `/introspect`) return real daemon data, or does it fail on a Claude-specific assumption (tool name, path, env var)?
- [ ] Test the anomaly skills explicitly: `update-context` (wrong frontmatter, §5) and `ctx` (frontmatter/body subcommand gap, §5.1). If Muse Code keys off frontmatter, both should misbehave in predictable ways  -  and that predictability is itself a useful Phase 0 result, because it proves frontmatter is the routing key.
- [ ] Test at least one skill end-to-end: `context-search` is the best candidate (daemon-dependent, user-visible), `contextus-setup` second (scaffolding + embed, but heavier).

### 8.5 The other lifecycle hooks

- [ ] SessionStart: documented in §8.0 (source startup/resume/clear/compact/fork, `systemMessage` capped at 1000 characters, seconds timeouts). Confirm live: payload values, `systemMessage` rendering, and timeout without blocking start.
- [ ] PostToolUse equivalent: **LIVE-UNVERIFIED**, not in the §8.0 documented excerpt. Tool names (verbatim)? Edited-path payload shape? Matcher syntax?
- [ ] Stop equivalent: **LIVE-UNVERIFIED**, not in the §8.0 documented excerpt, beyond SessionEnd being named as an event and `transcript_path` appearing in the UserPromptSubmit payload. Transcript path in a Stop context? Transcript timing (written before hook reads it, or the Claude gotcha repeats)? Loop guard equivalent to `stop_hook_active`? Stdout contract (must emit? must not emit?)? **Do not port the capture gate until all of these are answered live** (§3.4).

### 8.6 Session identity, capacity, and plugin manifest

- [ ] Session id: documented as a `session_id` field in the hook payload (§8.0, documented, not live-verified in a real session). Confirm live what value it carries, and whether a statusline-equivalent can write per-session stats keyed by it (§6). Do not look for a Claude-style `CLAUDE_CODE_SESSION_ID` env var as the primary source; the payload is the documented source.
- [ ] Statusline: **LIVE-UNVERIFIED**. Does Muse Code have one? Does it expose token/window usage? If not, record the capacity-guard degradation (§6) as a known port limitation.
- [ ] Plugin manifest: **LIVE-UNVERIFIED**, not in the §8.0 hook docs excerpt. What is Muse Code's manifest format and location, if any? Do not write one by guessing. If the documented hooks + daemon path (existing hooks + daemon, no manifest) works, the manifest is Phase 2, not Phase 0.
- [ ] Env vars: list every Claude env var the adapter touches (`CLAUDE_PLUGIN_ROOT`, `CLAUDE_CODE_SESSION_ID`) and find or rule out a Muse equivalent for each. An adapter that silently reads an unset Claude var on Muse will compute the wrong plugin root or no session id, and fail in confusing ways. The documented Muse session identity is a payload field, not an env var, so that part of the mapping is already documented, not guessed.

### 8.7 Model and credits sanity (Spark-first plan)

- [ ] Confirm the $150 Meta Model API credits are actually available in the Muse Code session. Update, Oct 26 morning, before the 1:00 PM ET window open: a form to claim the Meta credits appeared on the competition site. The form text says credits will be distributed in batches, to check the Billing page to ensure free credits are applied, that a credit card must be applied to the account in order to use the credits and make an API call, and that a Spend Limit notification can be set up on the Billing page if you do not want to spend beyond the $150 credit granted. That is a notification, not a confirmed hard cap. Partner credits (Baseten, Modal, Fireworks) had not appeared as of that morning check; they stay live-unverified.
- [ ] Confirm Spark (standard and Contributor) is selectable in Muse Code, and that Contributor mode is the mode actually in use (Contributor: $0.10/M input, $0.20/M output, in exchange for Meta using prompts/completions to train  -  a trade Anthony has explicitly accepted for this hackathon, on the reasoning that the submission already licenses the end result to the organisers; see §9). Spark selectability in Muse Code is live-unverified.
- [ ] Confirm what the Billing page shows once credits are claimed, including whether the Spend Limit notification actually blocks spend or only warns, and record the answer before the weekend's long sessions, not during them. Do not treat "card on file" as proof of a hard cap; the form text only promises a notification.
- [ ] Spot-check Spark quality on the actual port task (not just benchmarks): Spark 1.3's independent Intelligence Index is 48 vs Wonder 52 / Wonder Full 56, with Wonder's gain concentrated in agentic long-horizon work (Terminal-Bench 4.0: Spark 33% → Wonder 52% → Wonder Full 57%). The plan's Spark-for-bulk / Wonder-only-for-hard-planning split (mirroring the Sonnet-for-bulk / Opus-for-hard-plan pattern at Equip) is a cost decision to validate in Phase 0, not a quality claim to assert blindly.

### 8.8 The demo corpus, before filming

- [ ] Seed the vector-inspector corpus from real material only (past sessions, decisions, issue-#42 thread, PR #43 CI findings). Seed history, not the fix. **Issue #42 stays unfixed until filming**  -  the bug must stay alive for the camera.
- [ ] Spot-check retrieval on the known demo prompts; confirm #42 context surfaces in the top results with scores above the floor. If it does not, the problem is corpus/seeding or calibration, not the port  -  diagnose it before filming, not during.
- [ ] Confirm the daemon log tail reads well on camera (stages visible: expansion, grading, drops, injection receipt). The log tail is the fallback visibility channel if no Muse statusline exists (§6).

---

## 9. Explicit live-unverified items - everything this doc did not live-verify

This section exists so a reviewer can tell, at a glance, what Spark *did not* claim live. It uses the same two states as the rest of the doc. Anything not listed here but also not sourced to a file above or to §8.0 should be treated as live-unverified.

1. **DOCUMENTED, NOT LIVE-VERIFIED (§8.0, found 2026-10-25, SDK docs labelled 1.4, values checked against Muse Code 1.3.0, sources https://meta-models.github.io/muse-code-sdk/1.4/guides/extend/hooks/ , https://meta-models.github.io/muse-code-sdk/1.4/guides/plugins/reference/hook-events/ , https://dev.meta.ai/docs/muse-code/extending )**: hook config paths (user `~/.config/muse/settings.json` with `schema_version 1`, project `<project-root>/.muse/hooks.json`, managed hooks via `managed_hooks_path`, load order managed, then user, then project, at session start), events SessionStart (matched on source startup/resume/clear/compact/fork) and UserPromptSubmit (matcher `*` only), stdin as one snake_case JSON object (fields `hook_event_name`, `session_id`, `turn_id` omitted on SessionStart/SessionEnd, `cwd`, `transcript_path`, `model`, `permission_mode`, plus `source` on SessionStart and `prompt` on UserPromptSubmit, not delivered if over 256 KiB), stdout exit codes (0 success, 2 with stderr text blocks on blockable events, any other exit treated as hook failure with the session continuing), JSON injection form `hookSpecificOutput` with `hookEventName` and `additionalContext` under a closed camelCase schema (snake_case in, camelCase out), plain stdout added to model context on SessionStart, SubagentStart, and UserPromptSubmit and ignored elsewhere, `systemMessage` as a separate output capped at 1000 characters, stdout/stderr each capped at 16 KiB, and timeouts in seconds, default 600, not milliseconds. Project-folder trust is also documented: project hooks run only after the project folder is trusted (terminal trust prompt, or `--trust-workspace` for `muse exec`); user and managed hooks need no separate hook-level trust step. No live Muse Code session was run for this doc, so §8.0 is a checklist to confirm live, not a verified contract.
2. **LIVE-UNVERIFIED, including items the docs leave open**: installed-version behaviour for every §8.0 item above; the full event catalog (one page lists 17 events, the payload reference additionally lists SessionFork and ToolUseStart as observation-only, and PostToolUse and Stop equivalents are not documented in the §8.0 excerpt); real `transcript_path` and `model` values in a live session (docs examples show them as null and unknown); actual size-cap behaviour in practice at and above 16 KiB, including any combined cap across two hooks on the same event; trust flow in practice; timeout expiry behaviour; skills recognition, routing, and execution, including skill invocation syntax; plugin manifest format and location; statusline existence and format; and whether a statusline script can use the documented `session_id`.
3. **Credit timing and billing, updated Oct 26 morning**: the $150 Meta credits form appeared on the competition site before the 1:00 PM ET window open, with the form text quoted in §8.7 (credits in batches, card on file required to use them, Spend Limit notification on the Billing page). Whether partner credits (Baseten, Modal, Fireworks) are available and to whom, whether the Spend Limit notification blocks spend or only warns, and whether Spark is selectable in Muse Code, all stay live-unverified, carried forward as questions in §8.7.
4. **Official Rules**: at the time of the Oct 25, 09:54 ET scheduled check, the Official Rules were still unpublished on both the Meta and Cerebral Valley pages (only a "will be published before the Hackathon begins on October 26, 2026" notice). A MadRobot update on Oct 25 later claimed the rules had published with a prize split (Startup $550k, Indie $400k, bonus up to $50k) and judging weights (Impact 30%, Meta AI Tooling 25%, Demo 25%, Technical Depth 20%)  -  **that claim was not verified against the official pages for this doc**, because the text-fetch route to `dev.meta.ai` is blocked and the live-browser route is outside this doc's scope. The rules, when verified, govern the pre-built-work disclosure wording and demo length/format specs  -  check them before finalising any submission text.
5. **Active Memory**: Muse's advertised "Active Memory" (context carried through conversations, "Active Focus" keeping Wonder/Wonder Full on goal) is **marketing copy, not a verified capability** in this doc. It has not been tested, and it is tied in the copy to Wonder/Wonder Full  -  Anthony was not planning to use Wonder (Spark-first, §8.7). Whether Active Memory exists in Muse Code, in Spark, or at all, and whether it overlaps or competes with Contextus push injection, is a Phase 0 test, not a premise.
6. **Muse browser/mobile-device driving**: how Muse uses browsers and mobile devices (built-in computer-use/accessibility vs an MCP server) is live-unverified and separate from Contextus (§7). With Claude, mobile driving is wdio MCP; whether Muse needs an equivalent, has one built in, or cannot do it in Muse Code at all, is live-unverified.
7. **The daemon seam (§2.4)**: the per-request `agent` field, `hookEventName` emission, and `additionalContext` truncation are build-plan proposals, not implemented code. They may prove unnecessary if Muse Code accepts the documented Muse shape (§8.0) without extra truncation.
8. **Skill execution on Muse**: recognition (listing a skill) vs routing (invoking it) vs correct execution (daemon-backed results) are three different claims (§8.4). None is live-verified.
9. **The `update-context` anomaly's cause**: the wrong frontmatter (`use-jest-for-testing`) is verified as present (§5), but *why* it is there (copy-paste, placeholder, merge error) was not investigated, and no fix is proposed here beyond "fix or drop it before porting".

---

## 10. Cheating / integrity note  -  why this doc is allowed to exist before the window

This doc was written before the window, about a pre-existing project, for review of Spark's work  -  not as a submission, not as code, and not as a prompt to be fed into Muse Code to do the port. It is labelled **pre-contest planning**, and the Meta AI provider section (§4.3) added 2026-10-26 is also pre-contest planning, made before the window opened.

That distinction matters, and it is the same distinction the whole hackathon plan rests on:

- **Allowed, with disclosure:** Contextus itself (built before the window, under Equip, now authorised for hackathon use with company credit and an in-progress release note, on the condition of no public evangelism yet); planning documents (build plan, demo plan, this review doc); the seeded demo corpus (real history, not the fix).
- **Not allowed, and not done here:** fixing vector-inspector issue #42 before filming; planting a fix write-up in the corpus; presenting pre-window work as in-window work; submitting a demo pair that was not run as described (same prompt, same commit, control genuinely fresh).
- **The line for this doc:** if it is used only to review Spark, it never enters the submission and needs no disclosure beyond this note. If any sentence, diagram, or plan from it is copied into the submission write-up, that material becomes pre-window planning in the submission and should be disclosed as such, alongside the pre-built Contextus disclosure. When in doubt, disclose  -  the cost of an extra disclosure sentence is nil, and the cost of a discovered omission is the submission's credibility.

The actual port  -  hooks firing on Muse, injection landing in a Muse session, skills running against the daemon, the filmed A/B  -  is to be built Oct 26 - Nov 4, in the window, and reported honestly, including where it falls short of full Claude parity (awareness footer, PostToolUse, Stop, statusline, full skill set  -  see the build plan's cut order).

---

## 11. What a reviewer should check in this doc

For Anthony's review of Spark, the highest-value checks are not "does this sound plausible" but "does this match the repo":

1. **Hook fidelity:** open `hooks/hooks.json` and each `scripts/*.js` header and confirm the timeouts, matchers, stdin fields, and stdout shapes in §3 match the code. Any mismatch is a Spark error, not a porting judgement call.
2. **Number fidelity:** `plugin.jsonc` values (topK 5, floor 0.725, maxTokens 3000, expansion 0.775 / qwen2.5:3b / 5 s, nomic 768 dims) and capacity thresholds (70/80/85, floor ×1.2, topK 1 at minimal) against `daemon/server.ts` and `plugin.jsonc`. The stale 0.45 comment is a trap  -  a doc that quotes it as the floor has not read the value.
3. **Documented vs live-verified discipline:** every Muse Code claim should be either sourced to §8.0 as DOCUMENTED, NOT LIVE-VERIFIED, or marked LIVE-UNVERIFIED with a Phase 0 test. Any sentence in this doc that states a Muse Code fact without a source or a Phase 0 test is a failure of the doc's own rule  -  flag it.
4. **Skill count and anomaly:** count `skills/` (24) and confirm the `update-context` frontmatter anomaly and the `ctx` frontmatter/body gap. A doc that says "25 skills, all clean" has not looked.
5. **Cut-order sanity:** does the minimum port (§5.2, §8) actually match the demo's needs  -  push injection first, everything else cuttable  -  or has Spark smuggled a nice-to-have into the critical path?

If Spark got those five right, the doc is a sound basis for Phase 0. If it got any wrong, the error is in the review, not in the port  -  and that is exactly what this review exercise is for.
