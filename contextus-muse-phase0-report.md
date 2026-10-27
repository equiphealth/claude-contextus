# Contextus for Muse Code — Phase 0 report (live verification spike)

**Date:** 2026-10-26
**Branch:** `muse-port`
**Status:** Phase 0 complete. No code changes made (this file is the only new artifact, written on request after the report was delivered in-session).

## Verdict

The port is viable. Every hook Contextus needs (SessionStart, UserPromptSubmit, PostToolUse, Stop) exists, fires, and was exercised live; real injection landed visibly in live sessions; the plugin cycle works but the raw repo is uninstallable as-is (entry count + symlinks — packaging step required). 15 doc-vs-live discrepancies recorded below, none of them a no-go.

## Environment and method

- **Binary:** Muse Code 1.4.13 (SDK docs labelled 1.4, values checked against 1.3.0).
- **Model:** `muse-spark-1.3-contributor` (Spark Contributor), provider `meta`.
- **Method:** ~35 probe runs via `muse exec` (echo provider for mechanics, ~15 small meta runs for landing/consumption proof). All fixtures in `/tmp/phase0-probe`, `/tmp/phase0-fx`, `/tmp/phase0-fxlink`, `/tmp/phase0-xdg`, `/tmp/probe-personal`, `/tmp/phase0-init` — nothing in the repo. Hermetic `XDG_CONFIG_HOME` used for user-settings tests; the live `~/.config/muse/settings.json` was never modified. Hook outcomes read from `session.jsonl` (`hook_run_started` / `hook_run_terminal` records). SDK docs pages re-fetched live during the session to confirm the DOCUMENTED side.
- **Constraints honored:** repo untouched (`git status` identical before/after apart from this file), daemon never started or changed, no skills rewritten, no adapter implemented, vector-inspector issue #42 untouched, all work on `muse-port`, nothing pushed.

Conventions: **LIVE-VERIFIED** = actually run in this session with the quoted command/output. **DOCUMENTED, NOT LIVE-VERIFIED** = in the SDK docs (re-fetched live where noted) but not exercised here.

---

## 1. Hook contract (§8.0–8.3)

| Item | Verdict | Evidence (command → output) |
|---|---|---|
| Settings location | LIVE-VERIFIED | `cat ~/.config/muse/settings.json` → `{"schema_version": 1, "provider": "meta", "model": "muse-spark-1.3-contributor", ...}` |
| `schema_version` required | LIVE-VERIFIED | XDG settings without it → ``malformed settings file …: missing field `schema_version`…``, exit 1, no start (odd prefix: `Computer Use history limits (`tools.cua.history`):`) |
| Project hooks path | LIVE-VERIFIED | `<project-root>/.muse/hooks.json` fired under `--trust-workspace`. Shape is matcher-groups: event → `[{matcher, hooks: [{type, command, timeout}]}]`; placing `command` directly under the event yields `UnsupportedHandler: D66: unknown matcher-group field 'command' … group is skipped` |
| User hooks + managed hooks + XDG | LIVE-VERIFIED | `XDG_CONFIG_HOME=/tmp/phase0-xdg` honored; user-hook marker file written; `managed_hooks_path` file loaded |
| SessionStart stdin | LIVE-VERIFIED | `{"hook_event_name":"SessionStart","source":"startup","session_id":"01a…","cwd":"…","transcript_path":null,"model":"unknown","permission_mode":"default"}` — no `turn_id` |
| UserPromptSubmit stdin | LIVE-VERIFIED | Same keys plus `"prompt"` and `"turn_id"`; `model`/`transcript_path` are `unknown`/`null` on echo, real values (`muse-spark-1.3-contributor`/`meta`) on meta |
| Exit 2 + stderr blocks | LIVE-VERIFIED | Session log: `status=blocked, exit_code=2, effects=[blocked]`; CLI: `run ended with Cancelled`; turn reason = stderr text (`"reason":"blocked by phase0 probe"`) |
| Other exit fails open | LIVE-VERIFIED | exit 1 → `status=failed`, turn `terminal=completed`, echo output present |
| Timeout in seconds + kill | LIVE-VERIFIED | `timeout:1` with 5 s sleep → `status=timed_out, exit_code=null, error="hook timed out after 1s"`, turn completed |
| 16 KiB stdout cap = kill, not truncate | LIVE-VERIFIED | 16300 B → `completed, effects=['context']`; 17000 B → `failed, error="output_too_large: hook stdout exceeded its 16384-byte ceiling; the process tree was terminated and no stream was parsed"` |
| Trust gating | LIVE-VERIFIED | Untrusted cwd: hooks silently contribute nothing. `--trust-workspace` → `workspace trust: trusted source=run-flag`, hooks ran. This repo is already `trusted` in `~/.config/muse/trust.json` |
| Injection lands + is visibly used | LIVE-VERIFIED | Hook-emitted fact `eu-north-7` → model replied `eu-north-7`; PreLLMCall wire dump shows the text as a `developer`-role message |
| No `muse hooks` command | LIVE-VERIFIED | `muse --help` lists no `hooks` command (confirms the §8.0 trust correction) |
| `systemMessage` | LIVE-VERIFIED (partial) | SessionStart hook emitting `systemMessage` → `completed`; text retained in session log (1 occurrence), invisible in headless output. TUI rendering untested |

Hook identity format in logs (live): `run_id: "<file>:user_prompt_submit:def-<hash>:<n>"`.

---

## 2. Two-hook case + Claude output shape (§3.2b, §8.2)

- **Claude shape accepted verbatim — LIVE-VERIFIED.** `{"continue":true,"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"…QuarryMQ…"}}` → `completed, effects=['context']`, and the model used the fact (`QuarryMQ`). The feared `continue`-as-unknown-key rejection did not happen: `continue` is a valid top-level key on this event.
- **Two hooks both survive — LIVE-VERIFIED.** Query-like + footer-like hooks on the same event: both `completed`, both `effects=['context']`, wire capture shows user + 2 developer messages, deterministic `display_order` 0/1. 2×15 KB accepted — no combined cap at 30 KB (per-hook 16 KiB caps apply independently). Execution is **concurrent** (cross-source append order varied run to run: `managed,project,user` once, `managed,user,project` twice), so query-before-footer cannot rely on serial ordering.
- **Consumption is effort-dependent — LIVE-VERIFIED.** At minimal reasoning effort the model answered `unknown, unknown` with two separate developer messages (3 runs) but succeeded with both facts in one message (`FrobnicateDB, Memstash`); at default effort two messages worked (`FrobnicateDB, Memstash`). Phase 1 implication: prefer one merged injection over two `additionalContext` outputs.
- **Quoting vs using — LIVE-VERIFIED.** Models refuse to quote developer-role injections (`I can't share internal context notes`, `No system note provided one`) but use facts from them. Calibration/eval probes must test fact-use, not marker-repeat.

---

## 3. Skills end-to-end (§8.4)

- **Level 1 (reads) — LIVE-VERIFIED.** `muse skills list` shows user skills auto-discovered from `$HOME/.claude/skills` and `$HOME/.agents/skills` with no settings entry. Precedence `$HOME/.agents` > `$HOME/.claude`/`$HOME/.codex` via `skill-shadowed` diagnostics. Malformed skills (no YAML frontmatter) warn but don't break sessions. This session's own skill catalog matches the CLI list.
- **Level 2/3 personal (routes + runs) — LIVE-VERIFIED.** `muse skills validate /tmp/probe-personal` → `valid p0probe`; `muse skills install … --scope user` → installed at `$CONFIG_DIR/skills/p0probe` (i.e. `~/.config/muse/skills/`); listed `activation=on`; exec run output `PERSONAL-PROBE-RAN`; `muse skills uninstall p0probe` → `removed:1`, list clean.
- **Plugin skill — LIVE-VERIFIED.** Appears as `plugin:phase0fx:probe` at `plugin://…`, active immediately without review; exec run output `PROBE-SKILL-RAN`. Only differences vs personal: id prefix and `plugin://` path. `/<id>` and `/<plugin>:<id>` invocation forms are DOCUMENTED (packages page); headless runs invoked the skill by name in the prompt.
- **Anomaly skills — LIVE-VERIFIED.** `muse skills validate skills/update-context` → `valid use-jest-for-testing`: validates under the wrong frontmatter name, proving frontmatter is the routing key (§5 prediction confirmed). `context-search`, `ctx`, `create-context`, `context-status` all `valid` under correct names. The `ctx` frontmatter/body subcommand gap is behavioral, not a validation failure.
- **`AGENTS.md`, not `CLAUDE.md` — LIVE-VERIFIED.** `muse init --dry-run` scaffolds `# AGENTS.md — Muse Code reads this file as project rules…`.
- Incidental: skill catalog trims to 32 KB (`15 descriptions compacted`); `muse skills import --from claude --dry-run` is copy-based (`candidates:29`) and unnecessary given auto-discovery.

---

## 4. Plugin validate / install / approve (§4.4)

### Real Contextus package — validate passes, install refused (both live)

- `muse plugins validate .` → `valid contextus claude-compatible skills=24 commands=0 hooks=6 mcp=0 reminders=0 diagnostics=4` (exit 0). The 6 hooks = SessionStart 1 + UserPromptSubmit 2 + PostToolUse 1 + Stop 2. Diagnostics: `inputs`/`outputs` frontmatter unused, `author` presentation-only, symlink entries.
- `muse plugins install .` → `plugin package exceeds 20000 entries` (exit 1); `muse plugins list` → `no plugins`. Repo has 22,153 entries incl. `node_modules` (868 without), plus pnpm symlinks. **A packaging step is required before the real install/approve can be attempted.** That step is Phase 1 work — see §8 for what it means.

### Full cycle proven on a clean native fixture (`/tmp/phase0-fx`)

Manifest followed the §4.4 shape (`schemaVersion/name/displayName/version/description/compat/capabilities`, 1 skill + 1 command + 1 hook) and validated `native … diagnostics=0`.

| Step | Command → output |
|---|---|
| install | `muse plugins install /tmp/phase0-fx` → `installed phase0fx 0.0.1 enabled=true trust=user-local …` + `hooks require review before activation; skills and commands are active without review` |
| inspect (pre-approve) | `runtime-capability plugin:phase0fx:hook:probe-hook status=review_needed` |
| hook test | `muse plugins hook test phase0fx:probe-hook --fixture …` → `status=completed`; stdin delivered verbatim (fixture needs top-level `event`, not just `stdin`) |
| skill live | `plugin:phase0fx:probe` listed, inspected, and run (`PROBE-SKILL-RAN`) while hook still unapproved |
| approve | `muse plugins approve phase0fx` → `approve plugin:phase0fx:hook:probe-hook`; inspect → `status=trusted_enabled` |
| approved hook fires live | New `muse exec` session rewrote the hook's marker file with real stdin — including from an **untrusted** cwd (plugin trust is separate from workspace trust) |
| remove | `muse plugins remove phase0fx` → `removed phase0fx`, list → `no plugins` |

Residuals and notes: `remove` warns the cache dir `may remain` — `/…/plugins/cache/local/phase0fx` does remain; left untouched deliberately (store bookkeeping, user's call to clean). `plugins list` omits the built-in `threejs` plugin. A symlink-containing fixture variant was refused at both validate (`invalid … diagnostics=2`, exit 1) and install (`plugin contains symlink entries and cannot be installed`, exit 1).

---

## 5. Lifecycle hooks, identity, capacity (§8.5–8.6)

- **PostToolUse — LIVE-VERIFIED.** Native tool names are snake_case, observed verbatim: `write_file {content, path}`, `edit_file {find, path, replace}`, `read_file {path}`, `bash {command, …}`, plus system `submit_reminder_decision` (adapter must ignore non-file tools, as Claude's watcher does). Payload keys: `tool_name, tool_input, tool_use_id, tool_response, + common keys`. Claude-style matcher `Write|Edit` **fires on `write_file`** via documented aliases. Matcher grammar documented: omitted/`""`/`*` = all; `[A-Za-z0-9_|]+` = exact alternatives; else unanchored regex; `UserPromptSubmit`/`Stop` accept only `*`.
- **Stop — LIVE-VERIFIED.** Emitting nothing → `completed`. Marker-gated exit 2 → first Stop `blocked`, model continued and followed the stderr instruction (`Done. PINEAPPLE`); second firing carried `stop_hook_active=True` with `last_assistant_message='Done. PINEAPPLE'`. The capture-gate block-once pattern ports directly. `transcript_path` is `null` in exec Stop events — Stop mining must use `last_assistant_message` (+ `PostLLMCall.output_text_preview`) unless TUI differs.
- **SessionStart/SessionEnd — LIVE-VERIFIED.** Start: `source: "startup"` on exec. End fires on exec termination: `{"hook_event_name":"SessionEnd","reason":"other",…}` with `turn_id` omitted per docs.
- **Session identity — LIVE-VERIFIED.** stdin `session_id` plus env `MUSE_SESSION_ID`/`MUSE_THREAD_ID` (equal in top-level chats). No plugin-root env var for settings hooks. Hook cwd = project root (`PWD=/private/tmp/phase0-probe`).
- **Capacity without a statusline — LIVE-VERIFIED PATH.** No statusline exists in the CLI or hook docs, but `PostLLMCall` stdin carries `usage: {input_tokens, output_tokens, cached_tokens, cache_write_tokens, cache_read_tokens, reasoning_tokens}` per model call (first call observed: `input_tokens: 32891`). A PostLLMCall hook can accumulate per-session usage and feed the capacity guard — §6 has a live alternative to the Claude statusline bridge.
- **Manifest schema (§4.4) — LIVE-VERIFIED.** The documented native manifest shape validates `native diagnostics=0`; documented limits (manifest 128 KiB, SKILL.md 256 KiB, 4,096 entries, 16 nesting levels, no symlinks) re-confirmed on the live packages page — with the entry-ceiling exception in §6.1.
- **Model/credits (§8.7, partial).** Live payloads show `model='muse-spark-1.3-contributor', provider='meta'` — Spark Contributor confirmed in use. Billing page / credit caps are a user-side web check, still open.

---

## 6. Discrepancies: docs → live

1. **Package entry ceiling is 20,000 in the binary vs 4,096 documented** (`plugin package exceeds 20000 entries`). Both block the raw repo; the binary is ~5× more lenient than the docs.
2. **Event catalog is 19 rows live** (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, PostToolBatch, PreLLMCall, PostLLMCall, PreCompact, PostCompact, SubagentStart, SubagentStop, Stop, StopFailure, SessionEnd, Notification, SessionFork, ToolUseStart) vs "17" in the porting doc.
3. **Top-level `continue` is accepted**, not rejected — the Claude UserPromptSubmit shape works verbatim (§8.2's worry resolved).
4. **PostToolUse/Stop are documented** in the hook-events reference (payloads, block/stop semantics) — not merely "absent from the §8.0 excerpt" — and are now live-verified for the Contextus-needed subset.
5. **Same-event hooks run concurrently**; the documented managed→user→project order is registration order, not serial execution.
6. **Hook env is cleared at spawn but re-polluted** via `$SHELL -c` + `~/.zshenv` (live hook env contained real secrets; an inline marker var was correctly absent).
7. **`additionalContext` arrives as a developer-role message** (wire proof); models won't quote it but will use facts from it.
8. **Multi-message injection consumption is effort-dependent** (minimal fails, default works); single merged injection is the robust shape.
9. **`transcript_path` is null in every exec context** (all events); TUI value unknown.
10. **Native tool names are snake_case**; PascalCase works only as matcher aliases (verified for `Write|Edit` → `write_file`).
11. **`plugins remove` leaves its cache dir** (with warning); **`plugins list` omits built-in plugins**.
12. **`exec --json` carries no hook records**; `session.jsonl` (`hook_run_terminal`) is the observability channel.
13. **`skills import` copies, never links**; auto-discovery already covers `$HOME/.claude/skills` + `$HOME/.agents/skills`, so single-copy + host paths works without import. Managed install target is `$CONFIG_DIR/skills`.
14. **`--session-id` requires strict UUID hex** (non-hex rejected with usage error).
15. **Missing-`schema_version` error carries a stray prefix** (`Computer Use history limits (`tools.cua.history`): …`) — behavior correct (exit 1, hard refusal), prefix odd.

---

## 7. Open questions

Requires a TUI session, the Billing web UI, or Phase 1 work:

1. `transcript_path` value in real TUI sessions (null in all exec runs).
2. SessionStart sources `resume`/`clear`/`compact`/`fork` (only `startup` tested).
3. `systemMessage` rendering in the terminal UI (log retention verified headless only).
4. `$CONFIG_DIR/skills` vs `$HOME/.agents` vs `$HOME/.claude` precedence (only `.agents` > `.claude`/`.codex` observed).
5. Managed-file strict form (`name`/`timeout_ms`), `managed_hooks_env_vars` — untested.
6. `MultiEdit`/`NotebookEdit` matcher aliases (expect: match nothing) — untested.
7. `additionalContext` on Stop (expect: schema rejection) — untested; not needed.
8. 11 events DOCUMENTED but not live-verified (PreCompact, PostCompact, SubagentStart/Stop, PermissionRequest, PostToolUseFailure, PostToolBatch, StopFailure, Notification, SessionFork, ToolUseStart) — none on Contextus's hook path.
9. Billing page: credit presence, Spend Limit behavior (§8.7) — user-side check.
10. Daemon + LanceDB + Ollama on this machine; real-package install/approve after a packaging step — Phase 1.

## 8. Phase 1 handoff notes (findings, not work done)

### 8.0 The packaging step: what it means

It is primarily a **repo script plus a CI artifact** — not install-time work, though a minimal version of it is also what unlocks Phase 1:

- **Not install-time.** `muse plugins install` takes an already-valid bundle directory and only validates + copies it into cache. There are no build hooks, and the entry-count and no-symlink gates are enforced at install — so by install time the directory must already be clean.
- **What the step does.** Assemble a clean bundle directory with only what the plugin needs — manifests (`.muse-plugin/`, existing `.claude-plugin/`), `skills/`, `hooks/`, `scripts/`, `dist/`, `prompts/`, `plugin.jsonc` — plus production `node_modules` with no symlinks (pnpm's layout is uninstallable as-shipped; npm with `--no-bin-links` or equivalent is the shape to investigate). Verified baseline: 868 entries without `node_modules` (fits), 22,153 with (refused).
- **Three horizons.** (1) *Now, to unlock Phase 1:* a one-off or quick script assembling a minimal valid bundle so the real package's install/approve completes and adapter iteration uses `muse plugins update <id>` (refresh-from-source). For dev, the settings-hooks path (`.muse/hooks.json` pointing at a checkout) sidesteps most of this anyway. (2) *CI, for distribution:* a `pack` script producing a release artifact (tarball) or publishing into a marketplace repo — Muse supports `marketplace add` from Git and `install plugin@marketplace`. (3) *User install:* consumes the artifact from (2); no packaging happens there.

### 8.0.1 Further questions on packaging (open, Phase 1 decisions)

1. **Daemon runtime deps: inside or outside the bundle?** The daemon needs its `node_modules` (LanceDB native bindings etc.) at runtime. Either the bundle carries lean prod deps, or the daemon runtime is installed separately with hooks pointing at it. Decide deliberately.
2. **Entry-budget target: live 20,000 or documented 4,096?** A fat bundle fits the live binary today but likely not the documented figure — if a future binary enforces 4,096, the bundle breaks. Needs headroom policy (see discrepancy #1).
3. **npm vs pnpm for the production install?** pnpm's symlinked layout is uninstallable; whatever produces the bundle's `node_modules` must be symlink-free. Untested which tool/flags achieve this within budget.
4. **Per-platform bundles?** LanceDB ships native bindings — a single tarball may not run cross-platform (macOS arm64 vs Linux x64 at minimum). Untested; affects whether CI builds one artifact or a matrix.
5. **`dist/` committed vs built during pack?** Carried over from porting-doc §4.4, still open: keep committed `dist/` in the bundle, or build it in the pack step?
6. **Marketplace vs release-tarball distribution?** Both are supported install paths; which is the documented one for Contextus?
7. **Dev-loop ergonomics during adapter work:** settings-level hooks against a checkout vs installed-plugin `update` loop — which is the daily driver, and does the choice hide packaging bugs until release?
- Adapter output: merge query injection + awareness footer into **one** `additionalContext` (two-hook consumption is effort-sensitive).
- The Claude `{continue:true, hookSpecificOutput:…}` shape works verbatim on UserPromptSubmit — translation need is smaller than §8.2 feared (still required: `hookEventName` must equal the running event; snake_case in, camelCase out elsewhere).
- PostToolUse matcher: use native `write_file|edit_file` (PascalCase aliases also match, but native is exact).
- Stop hooks: read `last_assistant_message` from stdin, not the transcript; honor `stop_hook_active`.
- Capacity: prototype a PostLLMCall `usage` accumulator as the statusline replacement.
- Never log hook process env (contains `~/.zshenv` secrets under zsh).
- Fixture leftovers: `/tmp/phase0-*` (harmless, outside repo), `/…/plugins/cache/local/phase0fx` (deliberately left; remove by hand if desired).

---

## Addendum — 2026-10-27 (does not rewrite the 2026-10-26 findings above)

The original report above is preserved as written on 2026-10-26. This addendum records only what changed in status on 2026-10-27, so a later reader (including a Wonder design run) does not mistake a pasted finding for a file-verified one, or a still-open question for a decided one.

- **§8.1 is now file-verified, not pasted material.** On 2026-10-26 at 19:38 EDT a "Doc updated" message stating the lean-plugin decision was pasted in chat, and at 19:39 EDT Anthony clarified "Yeah sorry that's just from a copy paste" — the file on disk at that time still showed the old §4/§8, with no §8.1. On 2026-10-27 Anthony supplied `contextus-muse-phase0-report-2.md` (26,415 bytes, 184 lines), which does contain §8.1: **lean plugin + setup-owned deps + SessionStart nudge**, with the three reminder layers in robustness order (setup skill prominence + setup-as-verifier first, SessionStart check hook second, post-install message third), and the §8.1.1 traps (nudge hook must be zero-dependency; approve gap; deps must land in neither the installed plugin cache nor the plugin source dir; fresh-clone fragility).
- **Git-archive install is now file-verified.** Report-2 §4 records a `git archive HEAD` tree, fresh-clone simulation: **514 entries, 0 symlinks** → validate `valid contextus claude-compatible skills=24 commands=0 hooks=6 mcp=0 reminders=0 diagnostics=3` → install `installed contextus 0.20.0 enabled=true trust=user-local provenance=foreign-import` → inspect 24 skills and 6 hooks, all `review_needed` → remove clean, list → `no plugins`. No approve was performed on the real hooks (they are Claude commands and must never activate). Consequence recorded in report-2: "install from repo" works iff the source tree has no installed deps — the setup skill must never run a package install inside the plugin source dir.
- **§8.0.1 Q1 is decided in report-2; Q3, Q5, Q6, Q7 are not.** Q1, daemon runtime deps inside or outside the bundle, is marked DECIDED — outside, see §8.1 — and that dissolves Q2 (entry budget) and Q4 (per-platform bundles) as distribution problems, converting them into setup-skill requirements. Q3 (npm vs pnpm for the production install, symlink-free, untested), Q5, Q6, and Q7 remain open in report-2, exactly as in the original.
- **`dist/` remains open — Q5, not setup-built.** Report-2 §8.0 lists `dist/` as part of the clean bundle (manifests, `skills/`, `hooks/`, `scripts/`, `dist/`, `prompts/`, `plugin.jsonc`), and §8.0.1 Q5 still asks: keep committed `dist/` in the bundle, or build it in the pack step? It does not say setup builds `dist/`. A setup-built `dist/` is a new third option raised in chat on 2026-10-27, not a report-2 decision, and it conflicts with the current Claude constraint recorded the same day: **Claude Code currently needs `dist/` to exist in the repo.** If setup built `dist/` after install, a fresh install would have hooks pointing at a `dist/` that does not exist until setup runs — the same silent fail-open mode §8.1 warns about for the daemon. For a Wonder design run, `dist/` should be treated as open, with the current Claude constraint as input, and Wonder should decide between committed-in-bundle vs built-in-pack, or justify a setup-built option against that constraint — not assume setup-built is decided.
- **Input docs for a Wonder design run, as supplied 2026-10-27 09:56-09:59 EDT:** `contextus-muse-phase0-report.md` (this file, with this addendum; report-2 is the §8.1 source), `contextus-muse-porting-doc.md` (91,438 bytes, 665 lines, identical to the goal-workspace copy), and `contextus-overview.md` (8,969 bytes, identical to the goal-workspace copy). The porting doc and overview supplied on 2026-10-27 match, byte-for-byte by `diff -q`, the versions previously read from the goal workspace — no new content was introduced by re-supplying them.
- **Task framing correction, 2026-10-27 chat:** this is building Muse support into the same Contextus project, not a separate fork or port. Daemon unchanged, adapter at the edge, one generic copy of each skill, both manifests pointing at the same path, neutral `.contextus/` as the shared default. A design that creates a parallel Muse codebase, duplicates skills, or rewrites the retrieval pipeline for Muse contradicts the project framing.
- **Phase 1 scope, for reference:** the technical handoff is report §8 (packaging step, merged injection, native PostToolUse matchers, Stop mining from `last_assistant_message`, PostLLMCall usage accumulator, never log hook env), not just the build-plan's one-line "Wed Oct 28 — Phase 1 adapter." The build-plan date is schedule, §8 is scope; the date may shift to the weekend, the §8 scope has not changed.

---

## Addendum 2 — 2026-10-27, later same day (pnpm vs npm, and missing npm)

- **Q3 is deprioritised, not answered.** Anthony, 2026-10-27: "pnpm vs npm doesn't really matter i think. What matters more is what do we do if npm isn't available." That reframes §8.0.1 Q3. The pnpm-vs-npm choice mattered when deps might have been in the bundle, because pnpm's symlinked layout is uninstallable and a symlink-free bundle was the goal. Under the §8.1 decision, deps are setup-owned, outside both the installed plugin cache and the plugin source, so symlinks in that setup location do not trip the Muse install gates, which apply at install time to the bundle directory only. The manager choice is therefore an implementation detail, not a Phase 1 decision to spend design effort on.
- **What matters instead: the missing-package-manager / missing-Node bootstrap.** For a Wonder design run, specify a fallback chain, not a manager choice: setup checks `node --version` and then whichever package manager is present (`npm`, `pnpm`, `corepack`, in that order) and uses whichever is present to install into the setup-owned location. If none is present, setup must fail loudly, not silently fail open — the §8.1 failure mode, hooks pointing at a daemon that isn't there, looking working while doing nothing. Setup must not auto-install Node without explicit user approval (downloading a runtime, changing PATH, using nvm / volta / brew / winget is a system change outside what a plugin setup skill should do silently). The fallback is a clear manual step — install Node LTS, then re-run setup — and setup should verify daemon reachability after that re-run. For the hackathon demo this is an edge case, not a blocker (the demo machines have Node), but for the open-source release it is the first failure a new user will hit, and a loud "Node not found, install it, re-run /setup" beats a mysterious silent failure.
