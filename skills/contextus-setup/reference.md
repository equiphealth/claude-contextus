---
name: contextus-setup
description: Guided setup wizard — scaffold, configure, and embed for a project. Two tracks (quick/power user). First-run or re-configure.
---

# Contextus Setup Wizard

Interactive onboarding that gets contextus from "installed" to "actively injecting
your patterns" — with choices that match your workflow.

## When to Use

- **First time** in a project after installing the plugin (session-start nudges you here)
- After moving/renaming the project (re-register)
- **Re-configure** — run anytime to change settings or re-tune
- **Tune** — `/contextus-setup --tune` after ~1 week of real usage

## How to Run

```bash
/contextus-setup                  # guided wizard
/contextus-setup --tune           # calibrate thresholds from usage data
/contextus-setup --quick          # skip questions, use sane defaults
```

---

## Implementation Flow

When this skill is invoked, follow this exact sequence:

### Step 0: Detect State

Run the detection script to gather all project state in one shot:

```bash
# From the target project directory
tsx $CLAUDE_PLUGIN_ROOT/scripts/setup-detect.ts

# Or specify a different project
tsx $CLAUDE_PLUGIN_ROOT/scripts/setup-detect.ts --dir /path/to/project
```

`$CLAUDE_PLUGIN_ROOT` is set by Claude Code and points to the installed contextus plugin directory.

This returns JSON with: `ollamaReachable`, `ollamaState`, `platform`, `hasHomebrew`,
`hasStanza`, `hasProjectConfig`, `hasPopulatedContext`, `legacyMemory`, `projectDocs`,
`userMemory`, `userContext`, `existingProjects`, `corpusState`, `usageLogEntries`,
`currentConfig`.

Read this JSON before presenting anything to the user.

**Helper scripts available for Ollama installation:**
- `scripts/install-ollama.ts` — Auto-install Ollama (exports `installOllama()`)
- `scripts/pull-ollama-model.ts` — Pull embedding models (exports `pullModel()`, `OLLAMA_MODELS`)

Import these functions directly when needed, or invoke via `tsx` for CLI use.

### Step 0b: Muse host (only when running under Muse Code)

When this skill runs under Muse Code, the host is `muse`:

1. Detect with the host flag from the plugin's own scripts directory (the skill
   knows its install path; there is no verified Muse equivalent of
   `$CLAUDE_PLUGIN_ROOT`, so never reference one). Resolve `tsx` from the
   neutral bundle FIRST — bare `tsx` is usually absent on user machines
   (observed live 2026-10-29: `tsx: command not found`: on the very first
   setup step):
   ```bash
   ~/.contextus/daemon/node_modules/.bin/tsx <plugin-dir>/scripts/setup-detect.ts --dir /path/to/project --host muse
   ```
   Only run the sync in item 4 first when the neutral bundle is missing or
   version-stale; otherwise its `tsx` is already there. Under Muse's sandbox
   every new shell command prompts for approval — batch setup into as few
   invocations as possible (see item 7): do not run detection, provider
   checks, and config steps as separate commands when one engine call covers
   them.
   Added fields: `host`, `hasAgentsStanza` (AGENTS.md, not CLAUDE.md),
   `setupStamp` (`{present, host, completedAt}`), `museApproval`
   (`cli-missing` | `not-installed` | `review_needed` | `trusted` | `unknown`).
   Sandbox-denial signatures under Muse Code (observed live 2026-10-30 —
   do NOT treat as service-down): `tsx` failing with `EPERM ... listen ... .pipe` (its IPC
   server can't bind); `ollama list` failing with `connect: operation not
   permitted`; empty curl to `localhost:11434` or daemon `:37800` in the
   same session. These mean the sandbox blocked the socket, nothing about
   the service — never route to the installed-stopped / not-installed
   provider flows on this evidence. Instead request one user-approved
   escalated run covering Ollama tags + `ollama list` + daemon `/health`
   together (or ask the user to verify from their own terminal / re-run
   with `--sandbox-network enabled`), and prefer the single-shot engine
   call in item 5 for that run.
2. Read `AGENTS.md` everywhere below where the flow says `CLAUDE.md`, and read
   `hasAgentsStanza` where it says `hasStanza`. Re-run = `setupStamp.present`
   AND `hasAgentsStanza`.
3. Approval gate (hooks are inert until approved — no hook can remind about
   approval, so this check is the skill's job):
   - `review_needed` → instruct `muse plugins approve contextus`, then start a
     new session (approval takes effect next session). Stop — do not continue
     setup until re-detect shows `trusted`.
   - `not-installed` → the plugin itself is not installed. Stop with install steps.
   - `cli-missing` → fail loudly (Muse CLI not on PATH in this environment).
   - `unknown` → warn and continue; re-verify approval before finishing.
4. Runtime deps into the neutral home (DECIDED 2026-10-27, O13 option 1):
   verify `node` ≥ 22 (`package.json` engines), then run the setup engine
   with bare node (zero deps needed):
   ```bash
   node <plugin-dir>/scripts/sync-neutral-daemon.js
   ```
   This copies `{daemon,lib,scripts}/` + `package.json` + `tsconfig.json` to
   `~/.contextus/daemon/`, `git init`s it (throwaway repo, so the `prepare`
   hook lands harmlessly; requires `git` on PATH), runs a FULL `npm install`
   (`--no-audit --no-fund`, lifecycle scripts RUN, setup-owned cache — never
   `pnpm` in an install source, never the plugin cache or source tree),
   builds `dist/` with the LOCAL `tsc`, and writes the version stamp. Full
   install is deliberate: npm's `--omit=dev` + explicit-package interaction
   mis-resolves when the explicit packages are also dev-listed (observed:
   exit 0, dev-populated tree MISSING tsc/tsx). Scripts must run: sharp (via
   transformers) downloads its native binding in postinstall — skipping
   scripts installs clean and crashes the daemon at boot. Measured cost:
   ~470 MB runtime + ~360 MB cache, per machine, never shipped. Any failure
   exits non-zero — stop, report, do not proceed.
5. Run setup from the neutral copy (it has the deps the lean plugin lacks):
   ```bash
   ~/.contextus/daemon/node_modules/.bin/tsx ~/.contextus/daemon/scripts/contextus-setup.ts --host muse --dir /path/to/project
   ```
   Setup reuses a healthy daemon wherever it runs (never restarts/upgrades
   one), else starts the neutral `dist` build detached and polls `/health`
   until `modelLoaded` (90 s budget, then fail loudly). Declare success only
   on `modelLoaded: true`; check Ollama/model availability here and report
   it. Hooks never build; the 15 s hook budget is never spent here.
   On the **muse host**, a daemon spawned inside the session dies with the
   session (sandboxed shell: no `setsid`, `disown` may silently no-op) — so
   an in-session start is a bridge for setup only, never the permanent
   daemon. Whenever setup starts (or needs) a daemon on muse, ALWAYS also
   hand the user the terminal command below and say to run it in their own
   terminal; a daemon launched there survives independently. Do not present
   the in-session daemon as done — setup is done when the user confirms the
   terminal-launched daemon is healthy, or explicitly defers it. Hand them
   exactly this (installed by step 1 above, no repo checkout needed — it
   delegates to `ensureDaemonRunning()` itself, same as `manage-daemon`):
   ```bash
   bash ~/.contextus/scripts/daemon-restart.sh
   ```
   It preflights, stops any stale daemon, spawns via neutral dist / repo
   dist / dev tsx as appropriate, and polls `/health` until `modelLoaded`.
   Exit 0 means serving; anything else prints the cause plus a log tail.
6. Write the rules stanza to `AGENTS.md` (setup-owned, never hook-owned) and
   confirm `.claude/setup.json` exists — the SessionStart nudge reads that
   stamp. Never write the stamp by hand. If the engine's output includes
   `— seeded from sibling, needs a review pass` (true whenever `AGENTS.md`
   didn't exist yet but `CLAUDE.md` did), see
   **[Review a seeded rules file](#review-a-seeded-rules-file)** below —
   required, not optional, before telling the user setup is done.
7. Approval batching (observed live 2026-10-29: ~10 prompts on the quick
   path). Prefer the single-shot engine call in item 5 over step-by-step
   commands — one approval instead of ten. Narrate the upcoming approvals
   before the first one fires so the user knows the count; never work around
   the sandbox (no "unsandboxed" retries without explicit user approval —
   the elevated retry is the user's call, not the skill's).

### Step 1: Route Based on State

**If `--tune` flag:** Jump to [Calibration Mode](#calibration-mode).

**If `--quick` flag:** Jump to [Quick Track](#quick-track) (skip the opening question).

**If `hasStanza` AND `hasProjectConfig`** (re-run detected):

```
Contextus is already set up in this project.

Current state:
  Stanza:  registered in CLAUDE.md
  Config:  .claude/contextus.jsonc
  Corpus:  {corpusState}
  Provider: {embeddingProvider}

What would you like to do?
  [1] Re-configure (walk through options again)
  [2] Tune thresholds (needs ~1 week of usage data)
  [3] Nothing — I'm good
```

If [1] → Power User Track. If [2] → Calibration Mode. If [3] → exit.

**If `hasStanza` but NOT `hasProjectConfig`** (partial setup):
```
Looks like setup ran before but config wasn't saved. Want to finish configuring?
  [1] Yes — walk me through it
  [2] Just use defaults
```

**Otherwise** (first run): proceed to Step 2.

### Step 2: Opening Question

```
Welcome to contextus setup!

Contextus automatically retrieves relevant patterns from .claude/context/ and
injects them into Claude's context on every prompt — no searching required.
The context finds you.

How would you like to set this up?

  [1] Quick Setup — sane defaults, done in 30 seconds
  [2] Power User — explain each option, let me customize

(Both are safe to re-run anytime.)
```

---

## Quick Track

### Q1: Provider Check (branch on `ollamaState.status`)

**This is a machine-wide question, not a per-project one** — see the step-3
note below. If `embeddingProvider` from setup-detect already shows a value
(meaning the daemon already has one loaded), this question is really
"verify it's still working," not "choose one for this project." Only treat
it as a real first-time choice when nothing is configured anywhere yet
(truly first setup on this machine). If the user picks something that
DIFFERS from what's already active, say so explicitly before proceeding —
don't silently treat it as this-project-only.

#### State: `installed-running`
Skip this question entirely — Ollama is ready.

#### State: `installed-stopped`
```
Ollama is installed but not running.

  [1] Start it now (ollama serve in background) — quick
  [2] I'll start it manually
  [3] Use Transformers.js instead (~100MB download)
```

If [1]: run `ollama serve` in background, wait 2s, re-check. Continue to model pull.
If [2]: wait for user confirmation, re-check. If still down, loop back to this question.
If [3]: note `embeddingProvider: "transformers"` for config write.

#### State: `not-installed`
```
Ollama isn't installed (needed for embeddings).

  [1] Install automatically ({platform-specific-method})
  [2] Show me how to install manually
  [3] Use Transformers.js instead (~100MB download)
  [4] Skip embedding for now
```

**Option text for [1] by platform:**
- macOS + Homebrew: "Install automatically (brew install ollama)"
- macOS - Homebrew: "Install automatically (download from ollama.com)"
- Linux: "Install automatically (curl | sh from ollama.com)"
- Windows: (hide [1], only show [2-4])

**If [1]:**
- macOS + Homebrew: Run `brew install ollama`, wait 5s, verify binary, continue to model pull
- macOS - Homebrew: Show manual instructions (no auto-install)
- Linux: Run `curl -fsSL https://ollama.com/install.sh | sh`, wait 10s, verify, continue

Show progress: "Installing Ollama... (may take 1-2 minutes)"

On failure: "Install failed: {error}. Try [2] manual install or [3] Transformers.js?"

**If [2]:**
```
Visit https://ollama.com/download to install Ollama.

  macOS:    Download .dmg and drag to Applications
  Linux:    curl -fsSL https://ollama.com/install.sh | sh
  Windows:  Download .exe installer

Press Enter when installation is complete...
```
Wait for Enter → re-check binary → if still missing, show error and loop back.

**If [3]:** note `embeddingProvider: "transformers"` for config write.
**If [4]:** pass `--no-embed` to setup script.

#### After Install: Model Pull (if Ollama just installed or verified running)
```
Ollama ready! Now pulling embedding model...

  Using: nomic-embed-text (274MB, recommended)
  
This is one-time setup (model is cached locally).
```

Run: `ollama pull nomic-embed-text`
Show progress or wait silently (~30-60s depending on network).

On failure: "Model pull failed: {error}. Retry? [Y/n] or switch to Transformers.js [t]"

### Q2: Legacy Migration (only if `legacyMemory` is not null)

```
Found {legacyMemory.count} files in .claude/memory/ (legacy format).
Convert them to .claude/context/? (Better retrieval, typed, tagged.)

  [1] Yes — show me a dry-run first
  [2] Later — I'll run /migrate-memory when ready
```

If [1]: run `/migrate-memory` dry-run after setup completes.

### Q3: Transcript Mining

```
Mine past sessions for context that never got captured live?
This scans your last ~7 days of Claude Code history once, extracting
decisions/gotchas that slipped through (real LLM cost — one call per
session window, so a busy week of history costs more than a quiet one;
not yet benchmarked against real usage).

  [1] Yes, scan once now
  [2] No, skip for now

Also keep this running automatically? (checks once a session, ~daily at most,
only calls the LLM when there's actually something new to scan)

  [1] Yes — enable automatic recurring scans
  [2] No — I'll run /mine-transcripts manually when I want to
```

If [1] on the first question: pass `--mine-transcripts` to the setup script (step 2 below).
If [1] on the second question: add `transcriptMining.enabled: true` to `.claude/contextus.jsonc` (step 3 below). Default (both "No") writes nothing — `transcriptMining` stays at its config default (`enabled: false`).

### Execute (Quick Track)

1. Install discovery scripts and statusline bridges:
   ```bash
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-discovery-scripts.sh
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-statusline-bridge.sh
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-debug-statusline.sh
   ```
   The debug statusline installs silently either way — it's opt-in via `CONTEXTUS_DEBUG_STATUSLINE=1`, so installing it changes nothing for users who never set that var. If `jq` isn't available, this step logs a message and exits non-zero; don't treat that as fatal to the rest of setup.

2. Run the setup script:
   ```bash
   cd <target-project-cwd>
   tsx \
     $CLAUDE_PLUGIN_ROOT/scripts/contextus-setup.ts [--no-embed if needed] [--mine-transcripts if Q3a was Yes]
   ```
   If its output includes `— seeded from sibling, needs a review pass`, see
   **[Review a seeded rules file](#review-a-seeded-rules-file)** below before
   declaring setup finished — this is NOT optional cleanup, the file is a
   mechanical copy the script explicitly could not vouch for.

3. Write minimal `.claude/contextus.jsonc` (only if file doesn't already exist):
   ```jsonc
   // contextus config — edit to override defaults, or run /contextus-setup to reconfigure.
   // Docs: https://github.com/equiphealth/claude-contextus/blob/main/examples/contextus.jsonc
   {
   }
   ```
   **Never add `embedding` here, and there's no tier-2 project file for it
   either.** `lib/embedding/embedder.ts` reads ONLY the global
   `loadConfig()` — one daemon process, one loaded model, shared by every
   project on this machine; there is no per-project embedding override at
   ANY tier, full stop. Writing one into `.claude/contextus.jsonc` (or
   anywhere project-scoped) doesn't fail loudly — it just gets silently
   ignored by the actual embed call, which is worse. Caught live
   (2026-11-01): a stale tier-3 override on contextus's own dogfood project
   caused a live model-id mismatch exactly this way — see
   gotchas/gotcha-embedding-provider-switch.md. If Q1's answer differs from
   `plugin.jsonc`'s shipped default, that's not a setup-time config write at
   all — it's a machine-wide decision that needs editing `plugin.jsonc`
   itself, a daemon restart, and `/rebuild-embeddings --full` for every
   project + user scope on the machine. Flag this to the user rather than
   writing anything; don't make it look like a routine setup choice.
   If Q3b was Yes (enable recurring), add `"transcriptMining": { "enabled": true }` to `.claude/contextus.jsonc` — even if the file already exists (this one field is written regardless, since it reflects an explicit choice just made, unlike the rest of this step's "only if new file" scope). Transcript mining IS a team convention (whether this project wants retrospective scanning), unlike embedding provider.

4. If migration was requested, run dry-run of `/migrate-memory`.

### Summary (Quick Track)

```
Setup complete! Here's what you got:

  .claude/context/    scaffolded (add patterns here)
  CLAUDE.md           contextus stanza registered
  Corpus              {N} files embedded, ready to inject
  Provider            {Ollama or Transformers}
  Injection floor     0.45 (permissive — tune after a week)
  Hybrid search       always (keyword + semantic fusion)
  Query expansion     adaptive (fires when initial search is weak)
  Transcript mining   {N} pattern(s) from {N} session(s){if Q3a=Yes} / not run{if Q3a=No}
  Recurring mining    enabled (checks ~daily at session start){if Q3b=Yes} / disabled{if Q3b=No}

Sources active:
  Project context   .claude/context/          (your patterns)
  Project docs      docs/                     ({N} files){if projectDocs}
  User memory       ~/.claude/memory/         (cross-project, {N} files){if userMemory}

What to do next:
  /create-context       capture your first pattern
  /context-search       test what a prompt would retrieve
  /context-status       health dashboard
  /mine-transcripts      catch up on missed context from past sessions
  /contextus-setup --tune   calibrate thresholds (after ~1 week)

Context will be injected automatically on your next prompt. Ask naturally!
```

---

## Power User Track

### P1: Architecture Explainer (no question — just context)

```
Here's the 30-second architecture:

  UserPromptSubmit → daemon embeds your prompt → vector search → rerank → inject

Every prompt you type is embedded and matched against your curated patterns.
Matches above the injection floor are prepended to Claude's context, tagged
[contextus — ...]. You write patterns once; they appear when relevant.

Key features:
  • Hybrid search — semantic + keyword fusion via RRF
  • Multi-vector expansion — generates alternate phrasings when scores are weak
  • Injection floor — not every prompt should get context (that's intentional)
  • Per-project calibration — tune the floor to YOUR corpus
  • Multi-source — project context + docs + user-scoped memory

Let's configure each one. I'll explain as we go.
```

### P2: Embedding Provider (branch on `ollamaState.status`)

**Machine-wide, not per-project** — same caveat as Q1 above. If
`embeddingProvider` from setup-detect already shows a value, present this
as "here's what's already active" / "verify it's working," not a fresh
per-project choice. Flag explicitly if the user picks something different
from what's already active — see the step-2 note below for what that
actually requires.

#### State: `installed-running`
```
Embedding provider — how patterns are vectorized for search.

  [1] Ollama (recommended) — local, private, ~100-400ms per embed
      Status: INSTALLED, RUNNING ✓
      Model: nomic-embed-text (274MB)

  [2] Transformers.js — in-process ONNX, no external service
      Downloads ~100MB model on first run
```

If [1]: Check if model is already pulled. If not, pull it now.
If [2]: note `embeddingProvider: "transformers"` for config write.

#### State: `installed-stopped`
```
Embedding provider — how patterns are vectorized for search.

  [1] Ollama (recommended) — local, private, ~100-400ms per embed
      Status: INSTALLED, NOT RUNNING
      
      Start Ollama now?
        [a] Yes — ollama serve (background)
        [b] I'll start it manually

  [2] Transformers.js — in-process ONNX, no external service
      Downloads ~100MB model on first run
```

If [1a]: run `ollama serve` in background, wait 2s, continue to model selection.
If [1b]: wait for user confirmation, re-check service.
If [2]: note `embeddingProvider: "transformers"` for config write.

#### State: `not-installed`
```
Embedding provider — how patterns are vectorized for search.

  [1] Ollama (recommended) — local, private, ~100-400ms per embed
      Status: NOT INSTALLED
      
      Install Ollama now?
        [a] Auto-install ({platform-method})
        [b] Manual — show download instructions
        [c] Skip — I'll install later

  [2] Transformers.js — in-process ONNX, no external service
      Downloads ~100MB model on first run
```

**Option text for [a] by platform:**
- macOS + Homebrew: "Auto-install (brew install ollama)"
- macOS - Homebrew: (hide [a], only show [b] and [c])
- Linux: "Auto-install (official script)"
- Windows: (hide [a], only show [b] and [c])

**If [1a]:** Execute install via `scripts/install-ollama.ts`, wait, verify, continue to model selection.
**If [1b]:** Show manual instructions, wait for Enter, verify, continue if successful.
**If [1c]:** Set `embedding.provider: "ollama"` (machine-local, see below) but skip embedding (`--no-embed`).
**If [2]:** Set `embedding.provider: "transformers"` (machine-local, see below).

#### Model Selection (after Ollama verified running)
```
Choose embedding model:

  [1] nomic-embed-text (274MB) — recommended, best quality/speed
  [2] mxbai-embed-large (670MB) — higher quality, slower
  [3] all-minilm (45MB) — tiny, fast, lower quality
```

Pull the selected model: `ollama pull {model}`

**Don't write `embedding` to ANY project file — there is no per-project
override, at any tier.** `lib/embedding/embedder.ts` reads only the global
`loadConfig()`; one daemon process, one loaded model, shared by every
project. A write to `.claude/contextus.jsonc` (tier-3) or
`~/.contextus/data/<project>/config.json` (tier-2) would be silently
ignored by the actual embed call — worse than not writing anything, since
`/configure show` would then lie about what's really active. Caught live
(2026-11-01): a stale tier-3 override caused exactly this kind of
model-id mismatch on contextus's own dogfood project — see
gotchas/gotcha-embedding-provider-switch.md.

If this model selection genuinely differs from what's already active
(`setup-detect`'s `embeddingProvider`/`currentConfig`), that's a
machine-wide migration, not a setup-time config write: editing
`plugin.jsonc`'s `embedding` block directly, a daemon restart, and
`/rebuild-embeddings --full` for every project + user scope on the
machine. Tell the user this plainly and let them decide whether they
actually want to do it now — don't fold it into an "only if new file"
setup step like the rest of this section.

On pull failure: "Model pull failed. Retry [r] or use Transformers.js [t]?"

### P3: Retrieval Tuning

```
Retrieval settings — how aggressively context is injected.

topK: max patterns per prompt (more = broader but noisier)
  Default: 5 — good for corpora up to ~200 files
  [Keep 5] [3 (lean)] [8 (generous)]

injectionFloor: minimum similarity to inject (0.0–1.0)
  Default: 0.45 — permissive, lets borderline matches through
  After ~1 week, /contextus-setup --tune calibrates this to YOUR corpus.
  [Keep 0.45] [0.35 (more injections)] [0.55 (fewer, higher quality)]

maxTokens: token budget for injected context
  Default: 3000 (~1500 words)
  [Keep 3000] [2000 (compact)] [5000 (generous)]
```

### P4: Hybrid Search & Expansion

```
Advanced retrieval — these rarely need changing, but here they are.

Hybrid search: fuses keyword (BM25) + semantic results
  'always' = every query gets both (~20ms overhead)
  'off'    = pure semantic only
  [Keep always] [off]

Query expansion: generates alternate phrasings when initial search is weak
  'adaptive' = fires only when best_score < 0.55 (recommended)
  'always'   = every query (+100-200ms, higher recall)
  'off'      = disabled (saves latency)
  [Keep adaptive] [always] [off]

Expansion provider (default: Ollama `qwen2.5:3b` with Bedrock Haiku fallback —
needs nothing, no keys involved). Change it only to demo or debug another
backend:
  [Keep Ollama] [Meta (`muse-spark-1.3-contributor`)] [Anthropic]

If Meta or Anthropic: the daemon needs an API key, and setup must NEVER see
the key value itself — not pasted, not echoed, not captured. Ask for a FILE
path only:
  "Path to a file holding ONLY the API key? (first non-blank line is read)"

Validate without ever printing contents: the file must exist, be readable,
and non-empty — report only pass/fail and the path. Warn (do not block) if it
is group/world-readable. Write the PATH — never the key — to the
machine-local tier-2 file `~/.contextus/data/<project>/config.json`
(`projectLocalConfigPath()`), never to git-committed tier-3:
  { "expansion": { "provider": "meta", "model": "muse-spark-1.3-contributor",
      "timeoutMs": 25000 },
    "providers": { "meta": { "apiKeyFile": "<path>" } } }
(Meta is a reasoning model — it needs the generous timeout; the 5000ms default
is tuned for local Ollama.) Then verify live with one `expandQuery` before
declaring setup finished: a configured-but-broken key file throws naming the
path rather than silently demoting to fallback, and that error is only useful
here, at setup time — not weeks later on a weak query. Anthropic is the same
shape under `providers.anthropic.apiKeyFile`.
```

### P5: Sources

```
Sources — where contextus looks for patterns to inject.

  Project context  .claude/context/    {corpusState}       [enabled]
  Project docs     docs/               {N files found}     [enabled]
  User memory      ~/.claude/memory/   {N files found}     [enabled]
  User docs        ~/.claude/docs/     {exists or not}     [enabled if exists]
```

If `projectDocs` detected:
```
Docs frontmatter: Should contextus manage frontmatter on your docs/ files?
This adds name/description/type/tags headers for better retrieval.
  [Yes — manage frontmatter] [No — leave docs as-is (default)]
```

Then:
```
Any directories to EXCLUDE from embedding?
(e.g., prompts, archive, drafts — comma-separated, or 'none')
```

### P6: Notifications & Logging

```
Session-start notifications — how chatty is contextus?
  'verbose' = heartbeat even when everything is fine
  'normal'  = only on noteworthy events (spawn, failure, reconcile)
  'silent'  = never emit a session-start message
  [verbose] [normal (recommended)] [silent]

Paranoid logging — log full prompts + injections? (for debugging retrieval)
  Privacy-sensitive. Useful when tuning. Lives in ~/.contextus/logs/paranoid.jsonl.
  [No (default)] [Yes]
```

### P7: Capture Mode

```
Pattern capture — how contextus proposes new patterns to save.

  'staging' = writes patterns directly via /capture — git status is the review
              gate (you commit what's useful, discard what isn't) — the shipped
              default (plugin.jsonc)
  'propose' = suggests via footer instead, you confirm with /create-context —
              lower noise if you'd rather review before anything gets written
  'silent'  = never proposes (you create manually)
  [staging (default)] [propose] [silent]
```

### P8: Legacy Migration (only if `legacyMemory` is not null)

```
Found .claude/memory/ with {N} files from an older memory system.

These can be converted to .claude/context/ with proper typing, tags, and
retrieval-optimized frontmatter. The migration is:
  • Dry-run by default (shows plan, writes nothing)
  • Idempotent (safe to re-run)
  • Verify-before-embed (you check before it enters the corpus)

  [1] Run dry-run now (see the plan)
  [2] Skip — I'll do /migrate-memory later
```

### P9: Cross-Project Linking (only if `existingProjects` has entries)

```
Cross-project awareness: contextus is active in {N} other projects:
  {list of project names}

Would you like to link any of these? Linked projects share their
.claude/context/ patterns into your corpus (ranked below your own).

  [Link all]  [Pick specific ones]  [Skip]
```

If user chooses to link:
```bash
pnpm link-project <path-for-each-selected>
```

Explain: linked context ranks at 0.85 (below own patterns at 1.0), refreshes
automatically on macOS/Win, and can be managed later with `pnpm link-project --list`
or `/link-project`.

If no `existingProjects`, skip silently.

### P10: Transcript Mining

```
Transcript mining — retrospective safety net for context missed live.
Scans past Claude Code sessions with an LLM (Haiku via Ollama/Bedrock),
extracting decisions/gotchas that never got captured during the session
itself. Real cost per scan — one LLM call per session window, so cost
scales with how much history there is to catch up on (not yet
benchmarked against real usage) — dedup'd against your existing corpus
so it mostly no-ops once caught up.

One-time bootstrap scan (~last 7 days of history) now?
  [Yes, scan once] [No, skip]

Keep it running automatically going forward?
  'enabled: true'  = checks once per session start, ~daily at most,
                      only calls the LLM when something's actually new
  'enabled: false' = never automatic — run /mine-transcripts manually
  [enabled (recommended if you use Claude Code daily)] [disabled (default)]

If enabled, how often (in hours) should it re-check? [24 (default)] [custom]
```

If "Yes, scan once": pass `--mine-transcripts` to the setup script (step 3 below).
If "enabled": add `"transcriptMining": { "enabled": true, "intervalHours": <chosen or 24> }` to `.claude/contextus.jsonc` (step 2 below). If "disabled" (the default), omit the section entirely — `transcriptMining` stays at its config default (`enabled: false`).

### Execute (Power User Track)

1. Install discovery scripts and statusline bridges:
   ```bash
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-discovery-scripts.sh
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-statusline-bridge.sh
   bash $CLAUDE_PLUGIN_ROOT/scripts/install-debug-statusline.sh
   ```
   The debug statusline installs silently either way — it's opt-in via `CONTEXTUS_DEBUG_STATUSLINE=1`, so installing it changes nothing for users who never set that var. If `jq` isn't available, this step logs a message and exits non-zero; don't treat that as fatal to the rest of setup.

2. Write `.claude/contextus.jsonc` with all chosen values — **except
   `embedding`, which never goes in ANY project file.** There is no
   per-project embedding override at any tier (see P2 above) — a write to
   tier-2 OR tier-3 is silently ignored by the actual embed call, which
   only reads `plugin.jsonc`'s global default. If P2's answer differs from
   that default, it's a machine-wide migration (edit `plugin.jsonc`,
   restart the daemon, `/rebuild-embeddings --full` everywhere) — tell the
   user plainly rather than writing anything here:
   ```jsonc
   // contextus config — generated by /contextus-setup
   // Edit directly or re-run /contextus-setup to reconfigure.
   {
     "retrieval": {
       "topK": <chosen>,
       "injectionFloor": <chosen>,
       "maxTokens": <chosen>,
       "hybrid": "<chosen>"
     },
     "expansion": {
       "mode": "<chosen>"
       // + "provider"/"model"/"timeoutMs" ONLY if P4 changed the provider:
       //   those three, plus the apiKeyFile PATH, go to tier-2
       //   (~/.contextus/data/<project>/config.json), NEVER here —
       //   keys must not be git-committed
     },
     "notifications": {
       "verbosity": "<chosen>"
     },
     "logging": {
       "paranoid": <chosen>
     },
     "contextCapture": {
       "mode": "<chosen>"
     },
     "transcriptMining": {
       "enabled": <chosen>,
       "intervalHours": <chosen or 24>
     }
   }
   ```
   Only include sections where the user chose a non-default value. Omit defaults — that includes `transcriptMining` entirely if the user chose "disabled" (its own config default).

3. Run the setup script:
   ```bash
   cd <target-project-cwd>
   tsx \
     $CLAUDE_PLUGIN_ROOT/scripts/contextus-setup.ts [--no-embed if provider down] [--mine-transcripts if P10a was Yes]
   ```
   If its output includes `— seeded from sibling, needs a review pass`, see
   **[Review a seeded rules file](#review-a-seeded-rules-file)** below before
   declaring setup finished — this is NOT optional cleanup, the file is a
   mechanical copy the script explicitly could not vouch for.

4. If migration was requested, run `/migrate-memory` dry-run.

### Summary (Power User Track)

```
Setup complete! Here's your configuration:

  Provider            {choice}
  Injection floor     {choice} (calibrate later: /contextus-setup --tune)
  topK                {choice}
  maxTokens           {choice}
  Hybrid search       {choice}
  Query expansion     {choice}
  Capture mode        {choice}
  Notifications       {choice}
  Paranoid logging    {choice}
  Transcript mining   {N} pattern(s) from {N} session(s){if P10a=Yes} / not run{if P10a=No}
  Recurring mining    enabled, every {intervalHours}h{if P10b=enabled} / disabled{if P10b=disabled}

Sources:
  .claude/context/    {N} patterns embedded
  docs/               {N} files indexed
  ~/.claude/memory/   cross-project ({N} files)

Config: .claude/contextus.jsonc (git-commit this for team sharing)

Skills to know:
  /create-context        capture a new pattern
  /context-search        test retrieval against a prompt
  /context-status        health + activity dashboard
  /context-calibrate     tune thresholds (after ~1 week of real use)
  /contextus-watch       live tail of daemon activity
  /mine-transcripts       catch up on missed context from past sessions

Config changes take effect immediately — edit .claude/contextus.jsonc or use /configure.
Full calibration: /contextus-setup --tune (needs ~1 week of prompt history).
```

---

## Calibration Mode

Triggered by `/contextus-setup --tune` or chosen during re-run.

```bash
cd <target-project-cwd>
tsx \
  $CLAUDE_PLUGIN_ROOT/scripts/contextus-setup.ts --tune
```

**If `usageLogEntries` > 50:**

Run the script. It will:
1. Replay real prompts against the corpus
2. Build the similarity distribution + trade curve
3. Recommend `injectionFloor` + `expansionThreshold`
4. Show config diff

Present the results and ask:
```
Apply these thresholds?
  [1] Yes — write to per-project config
  [2] Show me the trade curve first
  [3] No — I'll think about it
```

If [1]: run `/context-calibrate --floor --apply`.

**If `usageLogEntries` < 50:**

```
Not enough usage data yet ({N} events, need ~50+).

The injection floor is calibrated by replaying YOUR actual prompts against YOUR
corpus — so it needs real usage to produce a meaningful recommendation.

Come back after using contextus for a week. /context-status shows your prompt count.
```

---

## Review a Seeded Rules File

When `writeStanza` creates `AGENTS.md`/`CLAUDE.md` for the first time and the
project already has the OTHER one, the setup engine mechanically copies that
sibling's content (minus its own stanza) as a starting point rather than
leaving the new file blank — otherwise a project onboarded to a second host
loses all of its real conventions for that host. But a script can't judge
which prose is host-portable vs. specific to the sibling's harness (skill
invocation syntax, hook names, tool names) — that copy is marked with a flag
comment at the top of the new file and reported in the engine's own output
(`— seeded from sibling, needs a review pass`), precisely because it is NOT
vetted. Do not treat "the file now has content" as "setup is done" when this
fires.

**What to actually do** (this is where judgment belongs — a human or a model
reading the result, never the deterministic script):

1. Read the newly-seeded file in full.
2. Flag anything that's specific to the SOURCE host and wouldn't make sense
   or wouldn't work for the NEW host's readers — e.g. a seeded `AGENTS.md`
   copied from `CLAUDE.md` may reference Claude Code skill slash-commands,
   hook event names, or tool names that Muse sessions can't invoke the same
   way. Rewrite or drop those lines; keep project facts that are genuinely
   host-agnostic (architecture, commands, workflow, conventions) as-is.
   Mirror the reverse direction too if seeding went `AGENTS.md` → `CLAUDE.md`.
3. Remove the flag comment once you've actually reviewed the file — leaving
   it in place after a real review just adds noise; leaving it in place
   WITHOUT reviewing is the failure mode this step exists to prevent.
4. Tell the user what you changed and why, briefly — this is user-owned
   content outside the markers; don't silently rewrite it without saying so.

---

## Idempotency

| State | Behavior |
|-------|----------|
| Never run | Full wizard |
| Stanza only (no config) | "Partial setup — want to finish?" |
| Complete (stanza + config) | Show state, offer re-configure / tune / exit |
| Config but empty corpus | Skip questions, just embed |

Re-running is always safe — the CLAUDE.md stanza updates in place (never duplicates),
config overwrites cleanly, and embedding skips unchanged files.

---

## Related Skills

- `/create-context` — capture your first pattern
- `/migrate-memory` — convert legacy `.claude/memory/` → context
- `/context-calibrate` — detailed calibration with --diff/--apply
- `/context-status` — health dashboard
- `/configure` — edit config interactively
- `/contextus-watch` — live daemon activity stream
