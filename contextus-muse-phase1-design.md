# Contextus — Muse support, Phase 1 design

**Date:** 2026-10-27
**Branch:** `muse-support`
**Status:** Design only. No implementation in this document. Do not fix vector-inspector issue #42. Do not push to `main`.

**Framing (settled, do not redesign):** Muse support lives in the same Contextus project, not a separate fork or port. The daemon and retrieval pipeline stay unchanged. New work is an adapter at the request/response edge, plus one small host-neutral daemon seam carrying origin/agent/hook-event, truncated to the documented 16 KiB output limit. Skills stay generic, one copy, optionally linked into host paths. Muse Code uses `AGENTS.md`, not `CLAUDE.md`, and finds personal skills in `$HOME/.claude/skills` and `$HOME/.agents`. Terminology: "context" / "context system", never "memory."

Sources of truth, in order: Phase 0 report (with 2026-10-27 addenda), porting doc, overview, then repo source. Where this document and repo source disagree, repo source wins; every such disagreement is called out inline. Official Meta Muse Code docs (SDK 1.4, fetched live in Phase 0) are cited as DOCUMENTED, NOT LIVE-VERIFIED unless Phase 0 exercised them.

---

## 0. Grounding audit

### 0.1 LIVE-VERIFIED findings relied on

Every item below was exercised in Phase 0 with the quoted command and output. Design decisions that depend on these are marked `(live)` inline.

| # | Finding | Evidence (Phase 0, verbatim substance) |
|---|---|---|
| L1 | Settings file location + `schema_version: 1` required | `cat ~/.config/muse/settings.json` → `{"schema_version": 1, "provider": "meta", "model": "muse-spark-1.3-contributor", ...}`; missing-`schema_version` file → `malformed settings file …: missing field 'schema_version' …`, exit 1, no start |
| L2 | Project hooks at `<project-root>/.muse/hooks.json`, matcher-group shape; edits take effect next session | `UnsupportedHandler: D66: unknown matcher-group field 'command' … group is skipped` when `command` placed directly under event; corrected group shape fired under `--trust-workspace` |
| L3 | User hooks at `hooks` member of `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`); managed hooks via `managed_hooks_path`; `XDG_CONFIG_HOME` honored | Hermetic-home runs wrote user-hook marker; managed file loaded |
| L4 | SessionStart stdin shape, no `turn_id` | `{"hook_event_name":"SessionStart","source":"startup","session_id":"01a…","cwd":"…","transcript_path":null,"model":"unknown","permission_mode":"default"}` |
| L5 | UserPromptSubmit stdin shape with `prompt` + `turn_id`; `model`/`transcript_path` real on meta, placeholder on echo | Field list in §1 of Phase 0 report; hook marker files |
| L6 | Exit 2 + stderr blocks (prompt rejected); terminal reason = stderr text | Log: `status=blocked, exit_code=2, effects=[blocked]`; CLI: `run ended with Cancelled` |
| L7 | Any other non-zero exit fails open; session continues | exit 1 → `status=failed`, turn `terminal=completed`, echo output present |
| L8 | Hook timeouts in seconds for settings hooks; expiry kills process tree, session continues | `timeout:1`, sleep 5 → `status=timed_out, exit_code=null, error="hook timed out after 1s"` |
| L9 | 16 KiB stdout cap is a kill, not a truncate (16384 bytes) | 16300 B → `completed, effects=['context']`; 17000 B → `output_too_large: hook stdout exceeded its 16384-byte ceiling; the process tree was terminated and no stream was parsed` |
| L10 | Project trust gates project hooks; `--trust-workspace` grants for `muse exec` | Untrusted cwd: no markers, no warning; trusted: hooks ran |
| L11 | `additionalContext` lands in model context as a `developer`-role message and is visibly used | Hook fact `eu-north-7` → reply `eu-north-7`; PreLLMCall wire dump shows the developer message |
| L12 | Claude output shape `{continue:true, hookSpecificOutput:{…}}` accepted verbatim on UserPromptSubmit | Fact `QuarryMQ` used by model; `completed, effects=['context']` |
| L13 | Two hooks on one event both apply (`effects=['context']` each); no combined cap at 30 KB; execution concurrent across sources | Wire shows user + 2 developer messages; order varied across runs |
| L14 | Multi-message consumption is reasoning-effort-dependent (minimal fails, default works) | Minimal: `unknown, unknown` (3 runs); default: `FrobnicateDB, Memstash` |
| L15 | Models refuse to quote developer-role injections but use facts from them | `I can't share internal context notes` vs `eu-north-7` fact-use replies |
| L16 | Personal skills auto-discovered from `$HOME/.claude/skills` and `$HOME/.agents/skills`, no settings entry; precedence `.agents` wins | `muse skills list` + `skill-shadowed` diagnostics |
| L17 | Personal skill installs, lists, runs, uninstalls end-to-end | `valid p0probe` → `PERSONAL-PROBE-RAN` → `removed:1` |
| L18 | Plugin skills need no approval; plugin hooks need `muse plugins approve`; approval bound to package hash; hooks wired at session start | Fixture cycle: `status=review_needed` → `approve` → `trusted_enabled`; approved hook fired in new session (also from untrusted cwd) |
| L19 | Plugin manifest (native) + capability limits validate/install as documented | Fixture `valid … native … diagnostics=0`; symlink variant refused at validate+install; repo checkout (22,153 entries) refused (`exceeds 20000 entries`), `git archive` tree (514 entries, 0 symlinks) `installed contextus 0.20.0` |
| L20 | Native tool names snake_case (`write_file`, `edit_file`, `read_file`, `bash`); PascalCase matcher aliases also match | PostToolUse dumps; `Write|Edit` fired on `write_file` |
| L21 | Stop honors `stop_hook_active` loop guard; `last_assistant_message` carries the response | Second Stop: `stop_hook_active=True`, `last_assistant_message='Done. PINEAPPLE'` |
| L22 | SessionEnd fires (`reason: "other"`, no `turn_id`); SessionStart `source: "startup"` on exec | Marker files on exec runs |
| L23 | `MUSE_SESSION_ID`/`MUSE_THREAD_ID` env = stdin `session_id`; hook cwd = session workspace; hook env cleared at spawn but `$SHELL -c` re-sources `~/.zshenv` | Env dump (9 secret-like vars, inline marker absent); `~/.zshenv` confirmed source |
| L24 | `PostLLMCall` carries per-call `usage` (input/output/cached/reasoning tokens) | `usage={'input_tokens': 32891, 'output_tokens': 26, …}` |
| L25 | Invocation forms `/<id>` and `/<plugin>:<id>` — DOCUMENTED only | Packages page; headless runs invoked by name in prompt (see D-list) |
| L26 | `update-context` frontmatter anomaly keys routing | `muse skills validate skills/update-context` → `valid use-jest-for-testing` |
| L27 | 24 skills; `ctx` frontmatter/body subcommand gap is behavioral | Directory count; `valid ctx` with frontmatter listing a subset |
| L28 | `AGENTS.md` (not `CLAUDE.md`) is the project-rules file | `muse init --dry-run` → `# AGENTS.md — Muse Code reads this file as project rules` |
| L29 | No `muse hooks` command; hook observability is `session.jsonl` (`hook_run_terminal`) | `muse --help`; log records with status/exit/effects/duration |
| L30 | Spark Contributor in use | Payload `model='muse-spark-1.3-contributor', provider='meta'` |

Doc-vs-live discrepancies from Phase 0 §6 that bind this design: (a) live entry ceiling is **20,000**, documented is 4,096 — design to the documented figure for headroom (see §3); (b) event catalog is **19 rows live**, not 17; (c) top-level `continue` is accepted (L12), so edge translation is smaller than the porting doc feared; (d) same-event hooks run **concurrently**, so no design may rely on serial hook order; (e) hook env leaks `~/.zshenv` — never log hook env.

### 0.2 DOCUMENTED, NOT LIVE-VERIFIED items

From the SDK 1.4 docs (fetched live in Phase 0) and the porting doc's §8.0. Never promoted to verified without a Phase 1 live check (see §6).

- Settings-file `hooks` member schema details (`type: "command"` handler fields, matcher grammar: `*`/omitted = all, `[A-Za-z0-9_|]+` = exact alternatives, else regex; `UserPromptSubmit`/`Stop` accept only `*`).
- Plugin manifest schema (128 KiB manifest, 256 KiB `SKILL.md`, 4,096 entries, 16 nesting levels, no symlinks; `compat` block; capability families incl. agents=0 family) — manifest *shape* live-verified via fixture, limits only documented + one live refusal.
- Timeout duality: plugin hooks `timeoutMs` (ms, default 600000, min 1000) vs settings hooks `timeout` (s, default 600, 0→1). Plugin side DOCUMENTED only (fixture hook test used the path, not a timed-out run).
- Exit-0 output read only when stdout starts with `{`/`[`; closed camelCase schema; top-level `additionalContext` rejects with `unsupported 'additionalContext' in output`; `systemMessage` ≤1000 chars (truncated); `suppressOutput` no-op; `continue: false` stops on "Stops: Yes" events; `decision: "block"` + `reason` semantics; `hookSpecificOutput.additionalContext` allowed only on SessionStart/SubagentStart/UserPromptSubmit/PreToolUse/PostToolUse/PostToolUseFailure/PostToolBatch/PreLLMCall/PostLLMCall; plain stdout added to context on SessionStart/SubagentStart/UserPromptSubmit only.
- Event table (19 rows) including block/context/stop columns; `PostToolUse` payload `tool_name, tool_input, tool_use_id, tool_response`; Stop `stop_hook_active` + `last_assistant_message`; SessionStart sources `startup/resume/clear/compact/fork`; `PreUserTurn` alias for UserPromptSubmit (claude-compatible only).
- `muse plugins hook test` fixture semantics (`{event, stdin}` delivered verbatim) — exercised once live, treat surrounding CLI flags as documented.
- Managed strict form (`name` + `timeout_ms`), `managed_hooks_env_vars`.
- MCP dual-door (§7 of porting doc): planned, not implemented, not Phase 1.
- **Doc/code disagreements found against the fresh clone (design to code):**
  - Porting doc §4.1 says code defaults are floor 0.35 / expansion threshold 0.55 — confirmed in `lib/config.ts` DEFAULTS (`injectionFloor: 0.35`, `expansionThreshold: 0.55`). No action; noted so nobody "fixes" the doc values as deployed values.
  - Phase 0 §8.0 lists `dist/` as bundle content while the 2026-10-27 addendum says `dist/` in-bundle vs built-in-pack is OPEN (Q5), and Claude Code currently needs `dist/` to exist in the repo. This design keeps committed `dist/` in the bundle (see §3) and does not assume setup-built `dist/`.
  - `plugin.jsonc` storage `path: "~/.contextus/data/{project-name}"` refines the `lib/config.ts` DEFAULTS storage path (`~/.contextus/data`); the deployed file wins via merge. No code change.

### 0.3 Open questions carried forward (proposed decision, not claimed fact)

Each keeps its source. Proposals are defaults for Phase 1 implementation; none is asserted as verified.

| # | Open question (source) | Proposed Phase 1 decision |
|---|---|---|
| O1 | `transcript_path` value in real TUI sessions (Phase 0 Q1) | Design Stop mining to `last_assistant_message` + `output_text_preview` with zero transcript dependence for the minimum port; re-enable transcript reads only behind a live TUI check (§6). |
| O2 | SessionStart sources `resume/clear/compact/fork` (Phase 0 Q2) | Handle all sources uniformly through the same daemon-warm path (`resume`/`compact` re-warm, `clear`/`fork` share warm); verify each with a TUI run (§6). |
| O3 | `systemMessage` rendering in the TUI (Phase 0 Q3) | Keep `systemMessage` for daemon announcements exactly as today (docs say it renders to user); confirm visually on the studio machine (§6). |
| O4 | Personal-skill precedence across `$CONFIG_DIR/skills`, `$HOME/.agents`, `$HOME/.claude` (Phase 0 Q4) | Document install order `.agents` first; treat any remaining collision as user-owned; do not rename. |
| O5 | Managed strict form + `managed_hooks_env_vars` (Phase 0 Q5) | Out of Phase 1 scope (internal deployments only); do not emit those keys. |
| O6 | `MultiEdit`/`NotebookEdit` matcher aliases (Phase 0 Q6, expect: match nothing) | Muse PostToolUse matcher uses native `write_file\|edit_file` only (L20); carry Claude matchers unchanged and let them keep matching Claude hosts. Do not rely on alias behavior for Muse. |
| O7 | `additionalContext` on Stop (Phase 0 Q7, expect: schema rejection) | Never emit it on Stop; log-only Stop behavior in Phase 1 (see §1.6). |
| O8 | 11 extra events documented, not live-verified (Phase 0 Q8) | Phase 1 uses only SessionStart/UserPromptSubmit/PostToolUse/Stop (all LIVE-VERIFIED). The rest are explicitly deferred, not designed. |
| O9 | Billing-page credits / Spend-Limit-as-cap behavior (Phase 0 Q9) | Spark-Contributor-first defaults in config (see §4); surface cost surface without claiming a hard cap exists. |
| O10 | Daemon, LanceDB, Ollama, embedding availability on target machines (Phase 0 Q10) | Setup checks and reports; keyword fallback when embeddings unavailable stays the documented degradation. |
| O11 | Muse model selectability beyond Contributor (Phase 0 §8.7) | Config takes any model id string; defaults to Contributor; Wonder is explicit opt-in (see §4). |
| O12 | Does `muse plugins update` re-run install gates? (Phase 0 addenda) | Verify in Phase 1 (§6); until verified, keep plugin source dir free of installed deps so either answer is safe. |
| O13 | `dist/`: committed-in-bundle vs built-in-pack (porting-doc Q5, Phase 0 addendum) | Keep committed `dist/` in the bundle. Do not make setup build `dist/` — a fresh install would then have hooks pointing at a `dist/` that does not exist until setup runs, the same silent fail-open §8.1 warns about, and Claude Code currently needs `dist/` in the repo. |
| O14 | Distribution channel: marketplace vs release tarball (porting-doc Q6) | Phase 1 ships install-from-clean-checkout only; marketplace/tarball deferred (see §3). |
| O15 | Dev-loop ergonomics: settings-hooks vs plugin `update` loop (porting-doc Q7) | Daily driver is plugin `update` against the clean bundle (mirrors the user path); settings-hooks loop is the fallback probe. Decision gated by the O12 check. |

---

## 1. Hook-by-hook adapter design

**Shape:** new adapter code only, in a new `adapter/` tree; the daemon is untouched except the §1.7 seam; existing Claude hooks/scripts are not modified. Phase 1 targets plugin hooks as the primary surface (matches the accepted install path: install → approve → setup) and settings-level `.muse/hooks.json` as the dev-probe fallback. Both surfaces share one implementation core.

**Why plugin hooks primary:** Phase 0 live-verified the full cycle (install → review_needed → approve → fires next session, L18/L19). Settings hooks work but duplicate wiring per project and cannot ship with the plugin.

**Project-hash invariant:** every adapter script computes `projectId = sha256(abs cwd), first 12 hex`, reusing the `scripts/lib/project-hash.js` computation (do not reimplement). Verified call sites: `scripts/lib/project-hash.js`, mirrored in `lib/config.ts`.

### 1.1 New files (adapter-owned; existing-file edits only in §2–§5 plumbing)

| New file | Role |
|---|---|
| `adapter/hooks.json` (plugin form) | Manifest hook definitions for Muse (argv form). Referenced from `.muse-plugin/plugin.json` (§3). |
| `adapter/muse-hooks.json` (settings form) | Dev-probe equivalent for `<project-root>/.muse/hooks.json`; same scripts, shell-command form. Generated once by setup, not hand-maintained twice. |
| `adapter/shared/emit.js` | Single emission point: snake_case in, closed camelCase out; byte-accurate truncation to 16384 B (L9); `hookEventName` always equals the running event. New code — no existing counterpart (existing hooks inline `emit`). |
| *(no other shared files)* | stdin reading is inlined per hook file (existing convention: every `scripts/*.js` hook carries its own `readStdin` with the TTY guard); project hash and daemon lifecycle come straight from `scripts/lib/project-hash.js` and `scripts/lib/daemon-control.js` via relative import (no wrapper copies — `project-hash.js`'s own header forbids a third copy of the formula). |
| `adapter/session-start.js` | §1.3. Zero-dependency (node stdlib only). |
| `adapter/query.js` | §1.4. Merged single injection (§1.8 reasoning). |
| `adapter/watch.js` | §1.5 PostToolUse `/notify`. |
| `adapter/stop.js` | §1.6 Stop usage-signal (log-only Phase 1). |
| `adapter/llm-capacity.js` | Optional PostLLMCall `usage` accumulator (§1.9). |

Explicitly out of Phase 1: `capture-gate-hook.js` Muse equivalent (§1.6), awareness as a second hook (§1.4), managed strict form (O5), `StopFailure`/`SessionFork`/`ToolUseStart` handlers (O8), MCP transport (porting-doc §7).

### 1.2 Declaration rules (every hook below)

- **Argv form, no shell** (Phase 0 docs): `command: ["node", "adapter/query.js"]` style.
- **Absolute script resolution** from `import.meta.url`; never read `CLAUDE_PLUGIN_ROOT` (no such Muse var on this path — Phase 0 §5). Any adapter read of a Claude-only env var here is a defect.
- **Timeouts in the host unit:** plugin hooks use `timeoutMs` (DOCUMENTED); settings form uses seconds. Both forms emitted from one source so surfaces cannot drift.
- **Fail-open everywhere** (porting-doc §2.5): any internal failure degrades to "no injection, session continues."

### 1.3 SessionStart — daemon warm + setup nudge

**Claude reference (source-verified):** `scripts/session-start-hook.js` ensures daemon up/warm, polls `/health`, fires background `/reconcile` check, never hangs start, reports via `systemMessage` (never `additionalContext` for announcements).

**Muse design:** event `SessionStart`, matched on `source` = `startup|resume|clear|compact|fork` (L4/O2): `startup` → full warm path; `resume`/`compact` → warm check; `clear`/`fork` → cheap `/health` check only. stdin `cwd` (project hash) + `session_id` (capacity key, §1.9). Daemon state via `systemMessage` (matches the "announce to user, never pollute context" rule); `additionalContext` only for the one-time setup nudge (§3.4). Zero-dependency, stdlib-only, bounded polling; failure emits nothing. The Claude `CLAUDE.md` discoverability check is **removed** here (L28) — the equivalent looks for an `AGENTS.md` stanza (§3.4) and still never edits it (setup owns that). Timeout `timeoutMs: 15000`.

### 1.4 UserPromptSubmit — merged single injection (demo core)

**Claude reference (source-verified):** `scripts/query-hook.js` (relay to `/query`) + `scripts/awareness-hook.js` (novelty-aware capture footer), sharing the event and relaying the Muse-shape output verbatim.

**Muse design:** **one hook, one `additionalContext`.** Retrieval relay + footer assembly happen internally; a single merged block is emitted. Why: two separate outputs both *arrive* (L13) but minimal-effort consumption drops the second (L14) and execution is concurrent (ordering unreliable). stdin keys: `prompt`, `cwd`, `session_id`, `hook_event_name` (`transcript_path`/`model` logged, never required — L5). Relay POSTs `/query` with `{ prompt, project, cwd, sessionId, agent: "muse", hookEvent: "UserPromptSubmit" }` (§1.7). Block order: header, chunks, whitelisted provenance footer, awareness footer (propose/staging/silent; `silent` omitted). Near-miss notice and capacity warning keep daemon-computed content (source-verified in `daemon/server.ts`) on the same block; plain miss stays silent. Empty prompt → no daemon call. Daemon down/slow → background restart, empty success (L7 pattern). Timeout `timeoutMs: 10000`, fetch abort strictly inside it.

### 1.5 PostToolUse — incremental re-embed

**Claude reference (source-verified):** `scripts/watch-contexts.js`, matcher `Write|Edit|MultiEdit|NotebookEdit`, only `.md` notified, daemon `/notify` owns routing (never hardcode `.claude/context/` in the client).

**Muse design:** event `PostToolUse`, matcher on native `write_file|edit_file` (L20/O6). stdin: `tool_name`, `tool_input` (`path`, with `file_path`/`notebook_path` tolerated), `cwd`. Non-file tools → no-op. Only `.md` notified; `/notify` body adds `agent: "muse"`. Always exit 0; daemon `fs.watch` remains the backstop for outside edits. Timeout `timeoutMs: 5000`, silent by design (no feedback context in Phase 1).

### 1.6 Stop — usage-signal logging only; capture gate deferred

**Claude reference (source-verified):** `scripts/stop-evaluation.js` (emits nothing; parses `Context: used:` footer; logs to `~/.contextus/logs/usage.jsonl`) and `scripts/capture-gate-hook.js` (off-by-default blocking prototype, `stop_hook_active`-guarded).

**Muse design:** event `Stop`, usage-signal logger only, reading `last_assistant_message` (L21) — no transcript-file dependence (O1/O7). No emit on the happy path; no `additionalContext` on Stop, ever. The capture gate is **not ported in Phase 1** (can block; needs a dedicated live check first, §6). `config.contextCapture.stopGate` is Claude-only in Phase 1. `stop_hook_active` is read for observability only — blocking on retry is forbidden. Timeout `timeoutMs: 5000`.

### 1.7 The one daemon seam

**Location:** `daemon/server.ts` `handleQuery` response assembly (+ `/notify` parity). No other `daemon/` change; retrieval pipeline untouched.

**Request (adapter → daemon):** two optional `/query` body fields the adapter sends: `agent: "muse"` and `hookEvent: "UserPromptSubmit"`. Claude clients send neither; absence means today's behavior bit-for-bit.

**Response:** when `agent` is present, the daemon (1) keeps the same `hookSpecificOutput.hookEventName` behavior, defaulting to the request's `hookEvent`; (2) fits the block intelligently (`fitBlockToCeiling` in `lib/retrieval/inject-format.ts`, wired via `PipelineConfig.byteCeiling` — unset on the Claude path, which keeps byte-identical assembly): never splits a chunk mid-line, never touches header/notice/footer, drops lowest-ranked chunks first with one-line references (path + section + score), and marks the truncation with dropped count + paths + a `/context-search` recovery pointer; under the ceiling the fit is the identity function; (3) leaves `continue` and all other fields unchanged. `shapeHookOutput` keeps a blind byte-cut as unreachable defense-in-depth only. The seam formats at the edge and never branches retrieval on host identity.

### 1.8 Emission helper

One `emit.js` for every hook: snake_case in, closed camelCase out, `hookEventName` equal to the running event, unknown-key guard (construct-listed keys only; unexpected keys dropped + logged, never forwarded — a forwarded unknown key would reject the whole answer and read as silent non-delivery). Exit 0 on all internal paths; Phase 1 has no deliberately-blocking hook.

Ceiling handling is divergence-proof by construction, not by duplicated logic: the daemon fit (above) already guarantees ≤16383 B, and the adapter **never re-cuts the daemon block**. `emitMerged` appends the adapter's awareness footer; if the merged text exceeds the ceiling it drops only its own footer (advisory, recoverable from `prompts/`, noted on stderr) and emits the daemon block intact. Only if the daemon block alone exceeds the ceiling — seam bypass, a defect not a mode — does a line-boundary cut with an explicit mark fire. SessionStart/Stop/PostToolUse outputs are small by construction (≤1000 B systemMessage cap; `{}` elsewhere).

### 1.9 Capacity signal without a statusline

**Claude reference (source-verified):** statusline writes `~/.contextus/runtime/<sessionId>.context-stats.json`; query hook forwards to `/query`; daemon guard (`capacityProtection` 70/80/85, floor ×1.2, topK 1 at minimal) adjusts retrieval.

**Muse design:** PostLLMCall hook (`adapter/llm-capacity.js`) reads `usage` (L24) + `session_id` and writes the **same file shape** (`{ input_tokens, output_tokens, used_percentage }`, same `~/.contextus/runtime/` location) so the daemon guard needs no change. Keyed by Muse `session_id` (payload source, L23), additive per session, best-effort (missing file = no adjustment, never an error). **Optional and off by default in Phase 1** behind the existing `capacityProtection` gate; `daemon.log` tail remains the fallback visibility channel.

---

## 2. Config translation

Two files stay distinct (do not merge them): `.claude-plugin/plugin.json` is the install manifest; `plugin.jsonc` is the runtime config read via `lib/config.ts` `findPluginJson()` (source-verified). The Muse manifest is additive — the runtime config does not get a Muse twin.

### 2.1 What translates, what does not

| Artifact | Claude (existing) | Muse (Phase 1) | Notes |
|---|---|---|---|
| Install manifest | `.claude-plugin/plugin.json` (name `contextus`, v `0.20.0`) | **New** `.muse-plugin/plugin.json` (see §3) | Both point at the same `skills/<name>/SKILL.md` files (porting-doc §4.4, agreed). Never two skill copies. |
| Runtime config | `plugin.jsonc` `config` block | **Unchanged, shared** | One file, two hosts. Hot-reload already works per query; no daemon restart for config edits. |
| Project override | `.claude/contextus.jsonc` | **Unchanged in Phase 1** | §5 decides the `.contextus/` default + read-both transition; until then the override name stays configurable and `.claude/` remains the project default. |
| Hook wiring | `hooks/hooks.json` (Claude events/matchers/ms timeouts) | `adapter/hooks.json` (plugin form) + optional `.muse/hooks.json` (settings form) | Timeout units differ (ms vs s vs Claude ms-as-unit) — adapter emits both forms from one source (§1.2). `matcher` is invalid in Muse manifests (fails validation) and `*`-only on `UserPromptSubmit`/`Stop` settings events (docs); adapter never emits a matcher there. |
| Project rules stanza | `CLAUDE.md` contextus stanza (setup-owned) | `AGENTS.md` stanza, generic wording, setup-owned (§3.4) | (L28). SessionStart never edits it. |
| Env vars | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_CODE_SESSION_ID` | None read on this path; `session_id` from stdin, `MUSE_SESSION_ID`/`MUSE_THREAD_ID` available but never depended on (L23) | `MUSE_THREAD_ID` ≠ top-level session in subagent contexts; payload wins on conflict. |
| Engines block | `plugin.jsonc`: `claude: ">=1.0.0"`, `node: ">=22.0.0"` | Muse manifest gets its own field only if the validator demands one (LIVE-UNVERIFIED what Muse requires) | Do not copy `claude: ">=1.0.0"` into a Muse file and assume it is ignored. `package.json` already pins `node: ">=22.0.0"` and is untouched. |

### 2.2 Runtime-config translation table (`plugin.jsonc` `config` — all values source-verified in `plugin.jsonc` + `lib/config.ts`)

Precedence is preserved exactly (`loadProjectConfig`: code defaults → `plugin.jsonc` → stored `~/.contextus/data/<project>/config.json` → `.claude/contextus.jsonc` wins). A port that drops the project override silently ignores the tuning a project ships with.

| Block | Values in play (code wins over comments) | Phase 1 handling |
|---|---|---|
| `providers.ollama` | `endpoint: http://localhost:11434` | Unchanged; primary expansion path stays local. |
| `providers.bedrock.region` | `us-east-1` | Unchanged; fallback only (§4 keeps it). |
| `providers.anthropic` | `{}` (no key baked in) | Unchanged; never bake secrets into `plugin.jsonc`. |
| `providers.meta` | **Does not exist** (`lib/config.ts:21` verified) | **New key** (§4): `{ endpoint?, apiKeyEnv }` — key from env var name, never a literal. |
| `sources.projectContext` | `.claude/context`, `CONTEXT.md` | Default stays `.claude/context` in Phase 1; §5 adds `.contextus/context` as a new default behind a read-both migration. Config key and excludes do not change. |
| `sources.projectDocs` / `userContext` / `userDocs` | `docs` / `~/.contextus/context` / `~/.contextus/docs` | Unchanged (user paths already host-neutral). |
| `lancedb` | `mode: file`, `~/.contextus/data/{project-name}` | Unchanged; unified DB with project-hash column. |
| `embedding` | provider `ollama` (deployed) vs `transformers` (code default), nomic 768-dim | Unchanged; provider swap = full re-embed + task-prefix audit (porting-doc §4.2) — not a Phase 1 flip. |
| `retrieval.topK/injectionFloor/maxTokens/hybrid` | `5 / 0.725 / 3000 / adaptive` (ignore the stale "0.45" comment — floor value is `0.725`, verified in `plugin.jsonc:90`) | Unchanged. |
| `similarityThreshold` | `0.7`, post-ranking filter, distinct from the floor | Unchanged; never conflate. |
| `expansion` | `adaptive`, `ollama/qwen2.5:3b`, fallback `bedrock/Haiku`, threshold `0.775`, 3 variants, 5 s | Provider wiring extended in §4; values unchanged. |
| `contextCapture.mode` / `stopGate` | `staging` deployed (code default `propose`) / `false` | Mode semantics preserved on the merged-footer path (§1.4); `stopGate` Claude-only in Phase 1 (§1.6). |
| `calibration.provider/model`, `usageEvaluation.provider/model` | `bedrock / Haiku` | Rewired per touchpoint in §4. |
| `capacityProtection` | `70/80/85`, enabled | Unchanged guard; Muse signal from §1.9 PostLLMCall file shape, no daemon edit. |
| `notifications.verbosity` | `verbose` deployed | Unchanged; SessionStart `systemMessage` consumes it (§1.3). |
| Logging/cost | `paranoid: true` deployed | Unchanged. |

### 2.3 Config files the adapter writes (and never writes)

- Writes: `.muse/hooks.json` (settings-form probe, setup-generated, §3), `AGENTS.md` stanza (setup only), per-session runtime stats (§1.9), usage/capture logs (same paths as Claude).
- Never writes: `~/.config/muse/settings.json` (host-owned; user hooks there are the user's choice), `plugin.jsonc` from a hook (config is human/setup-owned), `CONTEXT.md`/`DOCS.md` indexes (daemon-owned), any `.claude/` file from Muse hooks (Claude-host territory in Phase 1; §5 gates the shared default).

### 2.4 Documented-but-unverified surfaces deliberately excluded

Settings-level `hooks` member schema details and the managed-file strict form (`name` + `timeout_ms`, `managed_hooks_env_vars`) are DOCUMENTED, NOT LIVE-VERIFIED and are not emitted in Phase 1 (O5). `-c KEY=VALUE` per-run config overrides are likewise not used by the adapter.

---

## 3. Lean bundle and setup-owned deps

**Decision (settled in Phase 0 §8.1/§8.1.1, do not re-litigate):** keep the base repo as-is (deps never committed); install from a clean checkout; the setup skill installs deps and starts the daemon; a SessionStart check is the per-session reminder. Verified premise (Phase 0, git-archive tree): **514 entries, 0 symlinks** installs (`installed contextus 0.20.0 … trust=user-local provenance=foreign-import`); only an installed-deps/dev tree blocks install.

### 3.1 Install path (user-facing)

```
lean checkout (no node_modules)  →  muse plugins install <dir>
→  muse plugins approve contextus   (hooks: review_needed → trusted_enabled)
→  run setup skill in a new session  →  config created, deps installed, daemon started
```

Setup owns everything after approve, including verifying approval happened: `muse plugins inspect` reports `review_needed` vs `trusted_enabled` per hook (L18), so setup checks status and instructs the user to approve rather than self-approving hook definitions the user has not read. For now this sequence lives in installation instructions — no new auto-magic is required, and nothing in this section blocks on automating it.

Failure mode designed against: install without setup → hooks point at a daemon that is not there → silent fail-open (looks working, does nothing). The §3.4 reminder chain exists to break the silence.

### 3.2 The bundle (lean by construction)

The plugin bundle is the clean checkout itself: manifests, `skills/`, `adapter/` (§1), `scripts/`, `dist/`, `prompts/`, `plugin.jsonc` — **no `node_modules`, no build output, no symlinks, entry count targeted at the documented 4,096** (not just the live 20,000 — the documented figure is the portable contract, and the lean tree at ~514 entries has ~8× headroom). A `pack` check (not a transformation step) asserts at release time: entry count, no symlink entries, manifest parses, `dist/` present. CI produces a release artifact or marketplace snapshot from the same tree; users install the pre-built tree, never a working dev checkout (fresh-clone fragility, Phase 0 §8.1.1).

**`dist/` (O13):** committed `dist/` ships in the bundle. The daemon runs from compiled output (`node dist/daemon/server.js`); hooks must never point at a `dist/` that only exists after setup runs — that is the same silent fail-open as a missing daemon. Setup therefore never builds `dist/`; if it is missing, setup fails loudly with a restore step, not a build step.

### 3.3 Setup-owned deps (where packages go)

- Deps are installed by setup into a **setup-owned runtime location** — never the installed plugin cache (approval-hash flip risk: inspection hashes the package cache) and never the plugin source tree (an installed-deps source becomes uninstallable and may break `muse plugins update`; O12 pending verification).
- Package-manager rule: setup installs the daemon runtime with **npm, first and preferably only**. Rationale: npm ships with every Node install, so it is present exactly when Node is (no corepack download, no standalone pnpm bootstrap); and npm's layout keeps the runtime location free of the pnpm symlink farm that Muse's installer refuses if paths ever overlap. `pnpm` stays the repo's dev tool (`pnpm-lock.yaml`, local `tsc`/tests) and must never run inside a tree used as an install source — a checkout with any `node_modules` is uninstallable, whichever manager created it. Fallback if npm is somehow absent (exotic Node distributions): corepack-provided pnpm, then fail loud. If Node itself is missing, setup **fails loudly** with a manual step (install Node LTS → re-run setup → setup re-verifies daemon reachability). Setup never auto-installs Node or edits PATH without explicit user approval.
- After deps install, setup starts the daemon (`node dist/daemon/server.js` against the runtime deps), verifies `GET /health` (`modelLoaded`), and only then declares success. Ollama/model availability is checked and reported here (O10); keyword fallback is the documented degradation when embeddings are unavailable.
- Stale `~/.contextus/runtime/*.context-stats.json` cleanup (>24 h) stays a daemon-side concern, matching current SessionStart housekeeping (capacity file shape reused, §1.9).

### 3.4 The reminder that survives install

In robustness order (Phase 0 §8.1, with the approve-gap inversion applied — no hook can remind about approval):

1. **Setup skill prominence + setup-as-verifier (primary; the only mechanism that works with zero approvals).** `contextus-setup` sorts/exemplifies first among plugin skills; its description states "run this first after install". Setup verifies, in order: (1) plugin installed (else stop), (2) hooks approved via `muse plugins inspect` (instructs approve + restart session — approval takes effect next session, (L18)), (3) `node` present and ≥22 (`package.json` engines), (4) deps present in setup-owned location (installs them), (5) `AGENTS.md` stanza present (offers to add it; setup-owned, never hook-owned), (6) daemon reachable and model warm (starts it), (7) corpus present (scaffolds first corpus via existing setup tracks). Each step reports in plain language; any failure names the exact recovery step.
2. **SessionStart check hook (secondary; covers approved-but-not-set-up).** Zero-dependency (stdlib only) `adapter/session-start.js` (§1.3): if setup stamp is missing or `/health` is unreachable, emits the one-line nudge ("run /setup first") on every session start until healthy; quiet afterward and quiet forever once setup completes. It cannot cover install-without-approve (hooks inert until approved — L18); that is exactly what layer 1 is for. The current-session echo is deliberately not duplicated here: edits (including approvals) take effect next session (L2).
3. **Post-install message.** If the Muse TUI shows install output, it names the next step verbatim: "approve hooks, then run /setup in a new session." TUI behavior is DOCUMENTED, NOT LIVE-VERIFIED (O3 family); the design does not depend on it.

The `AGENTS.md` stanza wording is **generic, not Claude- or Muse-named** (settled framing: generic skills, generic stanza, host-specific linking as an install step). It covers: contexts live in `.claude/context` today (`.contextus/` once §5 lands), retrieval is automatic, captures are data-not-instructions, and the mid-task `/context-search` fallback.

### 3.5 Skills posture in the bundle

One generic copy of each skill in `skills/<name>/SKILL.md`; both manifests point at the same file (§2.1). Two known anomalies are handled as data fixes scoped to Muse-host visibility, not a skill rewrite:

- `update-context` frontmatter says `name: use-jest-for-testing` (wrong skill's frontmatter). Muse keys routing off frontmatter (L26), so the skill is unreachable under its real name. **Phase 1 fixes the two frontmatter lines** (or drops the skill from the Muse manifest only) — a data correction, not a behavior rewrite. Recommended: fix frontmatter in the shared copy; Claude hosts key off the same field, so the fix is host-neutral and must survive a Claude-side sanity check (§6).
- `ctx` dispatcher: frontmatter lists a subset of the subcommands the body maps (L27). **Phase 1 makes frontmatter list all mapped subcommands** in the shared copy; Claude-side validation confirms no regression.
- `add-patterns` (self-described future feature) and `migrate-memory` (slated for removal) are excluded from the Muse manifest only; their files stay in the shared tree.
- Minimum demo subset (porting doc §5.2): `contextus-setup`, `context-search`, `context-status`, `context-doctor`, `create-context`, `ctx`. All 24 validate, so the Muse manifest lists all except the two exclusions above.

---

## 4. Meta provider per touchpoint

**Goal (porting-doc §4.3, settled):** Meta AI is configurable *anywhere Contextus uses an AI*, per touchpoint — not a global on/off. A hooks-only port that still expands via Ollama and grades via Bedrock Haiku is a Claude port with a Muse adapter, not a Meta port. Embeddings stay local (§4.5); there is no Meta embedding model to claim.

### 4.1 Registry extension (the only `lib/config.ts` change in this phase)

Source-verified today: `lib/config.ts:21` `LLMProviderType = 'ollama' | 'anthropic' | 'bedrock'`; `lib/config.ts:23` `EmbeddingProviderType = 'transformers' | 'ollama'`; `providers` defaults carry `ollama`/`bedrock`/`anthropic` only.

Phase 1 changes:

- `LLMProviderType` gains `'meta'`. `EmbeddingProviderType` is unchanged.
- New `providers.meta` block (optional): `{ baseUrl?, apiKeyEnv: "META_API_KEY", defaultModel? }`. The API key is **never** a config literal and never baked into `plugin.jsonc`; config names the env var, the daemon resolves it at call time. Absent key → Meta calls fail open to the touchpoint's fallback (§4.3), exactly like any daemon failure.
- Provider resolution stays per touchpoint (`ExpansionConfig.provider`, `CalibrationConfig.provider`, `UsageEvaluationConfig.provider`, …). No global master switch is introduced, so a user can run Spark for expansion and a different model for grading without code changes (porting-doc §8.7 test, carried into §6).
- A new `lib/providers/meta.ts` implements the provider against the same call surface the existing providers present (single completion helper + logging of provider/model per call). No retrieval code imports it directly; touchpoints resolve provider/model as they do today.

### 4.2 Touchpoints (per-touchpoint provider + model)

| Touchpoint (source) | Today (source-verified) | Phase 1 Meta-configurable shape |
|---|---|---|
| Query expansion (`lib/retrieval/expand.ts`; `expansion.*`) | `ollama/qwen2.5:3b`, fallback `bedrock/Haiku`, 5 s, 3 variants, threshold `0.775` | Default **stays Ollama-primary** (offline story preserved); `provider: "meta"` + Spark model selectable. Fallback chain `meta → ollama → bedrock` only when Meta is primary; fast-failure-only fallback rule unchanged. Result logged with provider + model. |
| Calibration grading (`lib/calibration/eval-model.ts`, `--campaign`, eval worker) | `bedrock/Haiku` default | `calibration.provider: "meta"` selectable independently; Wonder permitted as explicit opt-in only (never default — cost, §4.4). |
| Usage evaluation (`usageEvaluation.*`, continuous + campaign) | `bedrock/Haiku`, `samplingRate: 1.0` | Same registry as calibration; graded through Meta when configured, independently of expansion. No change to sampling semantics. |
| LLM-assisted maintenance skills (`context-merge`, `context-tag --suggest`, transcript mining + capture summarization where an LLM is used) | Haiku via skill-level prompts | Same registry; skills read `providers.*` at runtime instead of hardcoding a model. Skill text stays generic (§3.5). |

### 4.3 Fail-open contract (mirrors daemon invariants)

Missing key, API error, or timeout on the Meta path fails open to the next configured fallback (Ollama preferred — offline — then Bedrock), with the same "expansion failure returns no variants, never blocks retrieval" shape the daemon already guarantees. Every Meta call is logged with provider + model (never just "succeeded"); a silently-swallowed Bedrock fallback on a Meta-configured install would misrepresent the contest story, so the fallback reason is part of the log record.

### 4.4 Cost control surface

Defaults are bulk-cheap: Spark (Contributor where the user accepted that trade) for expansion/grading bulk work; Wonder only when the user explicitly selects it for grading. `providers.meta` exposes the model id in every call site (nothing silently upgrades). Config surfaces: per-touchpoint model id + provider; the daemon log names provider/model/cost-relevant fields. No hard spend cap is claimed — the Billing Spend Limit is a notification (Phase 0 Q9/O9, honest copy in config comments and setup output).

### 4.5 Embeddings: local, honestly

`EmbeddingProviderType` gains nothing. nomic (768-dim) via Ollama or Transformers.js stays the only embedding path, with the `search_query:` prefix audit and full-re-embed rule on any provider/model swap (porting-doc §4.2). No Phase 1 text may claim Meta-powered embeddings.

---

## 5. Neutral `.contextus/` default — test with fallback

**Proposal (porting-doc §2.3, pre-contest planning, to fit into the port):** standardize the project default on `.contextus/` (context + config) so Muse and Claude share one corpus, one config, one embeddings index. Rationale: paths are already configurable; user-scoped paths are already neutral (`~/.contextus/context`, `~/.contextus/docs`); both `.claude/` (Claude-named) and `.muse/` (Muse-named) fragment the corpus across hosts. An `origin` field distinguishes which host captured what, alongside the §1.7 per-request `agent` field.

**This is a Phase 2 standardization gated by a Phase 1 test (§5.3). It is not a silent find-and-replace.** Existing corpora live in `.claude/context/`, index files name that path, skills name that path, and the setup wizard scaffolds that path (all source-verified). Renaming a live corpus in place or dropping the old path without a read-both period loses existing Claude users' corpora.

### 5.1 What changes if the test passes

| Surface | Today (source-verified) | New default |
|---|---|---|
| Project-context default in `plugin.jsonc` + `lib/config.ts` DEFAULTS | `.claude/context` | `.contextus/context` |
| Project config override | `.claude/contextus.jsonc` | `.contextus/contextus.jsonc` (override name stays configurable) |
| Skills naming the path | `.claude/context/` strings | New default; old path still recognized during transition |
| Setup wizard scaffold target | `.claude/` | `.contextus/` |
| Corpus format (frontmatter + body + `CONTEXT.md` index) | — | **Unchanged**; only the directory default and the migration change |

### 5.2 Migration (read-both transition)

1. **Read both.** During transition the daemon resolves project context from `.contextus/context` when present, else `.claude/context`; when both exist, both are sources (explicitly logged, never silently merged). Index files (`CONTEXT.md`) follow the same rule.
2. **Move or copy with history preserved** where possible (`git mv` semantics); re-embed only if the index path change invalidates the stored vectors (path-keyed rows) — otherwise the unified LanceDB index carries over untouched.
3. **Origin capture.** Captured files record host origin (`origin: claude | muse`) in frontmatter metadata, set at capture time from the request `agent` (§1.7); retrieval surfaces it in introspect/stats. Pre-existing files carry no origin and are treated as host-unknown, never backfilled by guess.
4. **Old path never dropped without a read-both period.** Removal of `.claude/` support is a later, separately-announced release decision; Phase 1 only adds the new default behind the test.

### 5.3 The Phase 1 test (gate)

On a test project: configure a Claude-style session and a Muse session against the **same** `.contextus/` corpus; capture from one host; retrieve from the other; confirm the `origin` field is recorded and both hosts rank the shared pattern in top results above the floor.

- **Pass:** shared retrieval with correct origin, one corpus, one config, one index — rename proceeds as the Phase 2 standard (§5.1/§5.2).
- **Fail:** the neutral path is still a good Phase 2 standard, but the minimum port keeps `.claude/` for Phase 1 and treats the rename as a deliberate migration, not a blocker. No re-run of this gate is owed before Phase 1 ships Phase 1 scope; it gates Phase 2, not Phase 1.

---

## 6. Live verification checklist

Every item has a pass/fail observable. A DOCUMENTED item becomes LIVE-VERIFIED only by executing its check and recording the exact command + output in the Phase 1 work log. Until then its label stands. Checks run against the studio machine's installed Muse Code version (record the version with `muse --version` at the top of the log).

### 6.1 Hooks (§1)

- [ ] **H1 (UserPromptSubmit merged injection).** Claude-style project with seeded corpus; Muse session sends the demo prompt. **Pass:** `additionalContext` contains retrieval + whitelisted footer in one block; model reply references corpus content (fact-use probe — L15 — never marker-repeat). **Fail:** split blocks, missing footer, or silent drop (check `session.jsonl` `hook_run_terminal` status/effects).
- [ ] **H2 (Seam truncation).** Craft `/query` output >16384 B. **Pass:** hook receives ≤16383 B, hook completes, header/footer intact in context. **Fail:** hook killed / `output_too_large`.
- [ ] **H3 (PostToolUse native matcher).** Edit a `.md` file via Muse tools. **Pass:** `/notify` fires for `write_file|edit_file`, daemon logs single-file re-embed, next prompt retrieves the edit. **Fail:** no notify, or non-`.md`/non-file tools notify.
- [ ] **H4 (Stop logging-only).** Normal turn. **Pass:** usage event logged from `last_assistant_message`; no Stop stdout; no turn blocked. **Fail:** any Stop emit on the happy path.
- [ ] **H5 (Capture gate stays off).** `git commit` turn with `stopGate: false`. **Pass:** no block on Muse host. **Fail:** any Stop block.
- [ ] **H6 (SessionStart sources).** TUI: start, resume, clear, compact, fork. **Pass:** each fires the warm path for its source class; daemon state via `systemMessage` renders to the user (O3 closes here). **Fail:** hang >15 s, model-context announcement, or missed source.
- [ ] **H7 (Capacity accumulator, when enabled).** PostLLMCall writes per-session stats file; `/query` honors reduce/minimal/disable tiers at 70/80/85. **Pass:** injection shrinks/disables with warning at threshold. **Fail:** guard silent or file shape rejected.

### 6.2 Config (§2)

- [ ] **C1 (Precedence).** Project override beats `plugin.jsonc` beats defaults on the Muse host. **Pass:** changed floor/topK in `.claude/contextus.jsonc` moves retrieval without daemon restart. **Fail:** override ignored.
- [ ] **C2 (Hot reload).** Edit `plugin.jsonc` mid-session. **Pass:** next query reflects it. **Fail:** requires restart.
- [ ] **C3 (Engines field).** Validate the Muse manifest with and without an `engines` field. **Pass/fail recorded verbatim** (closes the LIVE-UNVERIFIED engines question either way).

### 6.3 Bundle + setup (§3)

- [ ] **B1 (Lean install).** Clean checkout → `muse plugins validate` → `install` → `inspect` (hooks `review_needed`) → `approve` → next session hooks fire. **Pass:** all steps exit 0; injected context lands (H1). **Fail:** any gate fires on the lean tree.
- [ ] **B2 (Dirty-tree refusal is graceful).** Same steps against a checkout with `node_modules`. **Pass:** refusal message understood by a first-time user; no partial install. **Fail:** silent or corrupted plugin store.
- [ ] **B3 (Setup closes the loop).** Fresh machine profile (no Node-less simulation needed — PATH stripped of package managers). **Pass:** setup detects missing manager, fails loudly with manual step, re-run succeeds, `/health` reachable, nudge goes quiet. **Fail:** silent fail-open at any step.
- [ ] **B4 (Nudge honesty).** Install without approve. **Pass:** skills visible, no hook fires (expected), setup skill instructs approve; after approve + new session, nudge fires until setup completes, then stops. **Fail:** nudge fires pre-approve (should be impossible) or persists post-setup.
- [ ] **B5 (`plugins update` gates — closes O12).** Modify bundle source, `muse plugins update contextus`, then run H1. **Pass/fail recorded verbatim**; if update re-gates on a dirty source, setup docs must keep the source clean (already required by §3.3).
- [ ] **B6 (Skills anomalies).** After frontmatter fixes: `/update-context` and `/ctx tag` route. **Pass:** both invoke correctly on Muse; Claude-side validation unchanged-green. **Fail:** either dead or Claude regression.

### 6.4 Meta provider (§4)

- [ ] **M1 (Expansion via Meta).** `expansion.provider: "meta"` + Spark model; run a below-floor prompt. **Pass:** expansion variants returned; daemon log names provider + model. **Fail:** silent Bedrock fallback (log must show the reason).
- [ ] **M2 (Fail-open).** Repeat M1 with key env unset. **Pass:** fallback to Ollama (then Bedrock), retrieval unaffected, log records fallback reason. **Fail:** blocked prompt or unlogged fallback.
- [ ] **M3 (Independent touchpoints).** Expansion on Spark, grading on a different provider/model. **Pass:** each grades/expands as configured with no code change. **Fail:** cross-talk.
- [ ] **M4 (No embedding claims).** Introspect/stats still report nomic 768-dim. **Pass:** unchanged. **Fail:** any Meta-embedding claim in output.

### 6.5 Neutral path (§5) + hardening

- [ ] **N1 (§5.3 gate).** Shared `.contextus/` corpus: capture from one host, retrieve from the other, `origin` correct, above floor. **Pass:** Phase 2 rename proceeds. **Fail:** keep `.claude/` for Phase 1 (documented outcome, not a release blocker).
- [ ] **N2 (Env hygiene).** Hook scripts log nothing from process env; grep daemon + hook logs for secret-shaped values after a full session. **Pass:** none found. **Fail:** any env dump in logs (L23 hazard).
- [ ] **N3 (Eval honesty).** All Phase 1 demo/verification prompts use fact-use probes (L15). **Pass:** no marker-repeat probe anywhere in the log. **Fail:** a quote-style probe used as evidence.
- [ ] **N4 (Doc-claim audit).** Re-read this document's §0.1/§0.2 against the work log: every LIVE-VERIFIED line traces to a command+output; every DOCUMENTED line still labeled. **Pass:** trace complete. **Fail:** any silent promotion.







