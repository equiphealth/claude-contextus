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
decisions/gotchas that slipped through (real LLM cost, usually a few cents).

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

3. Write minimal `.claude/contextus.jsonc` (only if file doesn't already exist):
   ```jsonc
   // contextus config — edit to override defaults, or run /contextus-setup to reconfigure.
   // Docs: https://github.com/equiphealth/claude-contextus/blob/main/examples/contextus.jsonc
   {
   }
   ```
   If user chose transformers in Q1, add `"embedding": { "provider": "transformers" }`.
   If Q3b was Yes (enable recurring), add `"transcriptMining": { "enabled": true }` — even if the file already exists (this one field is written regardless, since it reflects an explicit choice just made, unlike the rest of this step's "only if new file" scope).

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
**If [1c]:** Set config `embedding.provider: "ollama"` but skip embedding (`--no-embed`).
**If [2]:** Set config `embedding.provider: "transformers"`.

#### Model Selection (after Ollama verified running)
```
Choose embedding model:

  [1] nomic-embed-text (274MB) — recommended, best quality/speed
  [2] mxbai-embed-large (670MB) — higher quality, slower
  [3] all-minilm (45MB) — tiny, fast, lower quality
```

Pull the selected model: `ollama pull {model}`

Store in `.claude/contextus.jsonc`:
```jsonc
{
  "embedding": {
    "provider": "ollama",
    "ollamaModel": "{selectedModel}"
  }
}
```

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
itself. Real cost per scan (usually a few cents), dedup'd against your
existing corpus so it mostly no-ops once caught up.

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

2. Write `.claude/contextus.jsonc` with all chosen values:
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
     },
     "embedding": {
       "provider": "<chosen>"
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
