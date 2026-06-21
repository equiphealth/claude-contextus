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
cd <target-project-cwd>
~/src/claude-contextus/node_modules/.bin/tsx ~/src/claude-contextus/scripts/setup-detect.ts
```

This returns JSON with: `ollamaReachable`, `hasStanza`, `hasProjectConfig`,
`hasPopulatedContext`, `legacyMemory`, `projectDocs`, `userMemory`, `userContext`,
`existingProjects`, `corpusState`, `usageLogEntries`, `currentConfig`.

Read this JSON before presenting anything to the user.

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

### Q1: Provider Check (only if `ollamaReachable` is false)

```
Ollama isn't responding at localhost:11434 (needed for embeddings).

  [1] I'll start it now (ollama serve) — tell me when ready
  [2] Use Transformers.js instead (downloads ~100MB model on first run)
  [3] Skip embedding for now (context won't inject until fixed)
```

If [1]: wait for user confirmation, re-check Ollama. If still down, ask again.
If [2]: note `embeddingProvider: "transformers"` for config write.
If [3]: pass `--no-embed` to setup script.

### Q2: Legacy Migration (only if `legacyMemory` is not null)

```
Found {legacyMemory.count} files in .claude/memory/ (legacy format).
Convert them to .claude/context/? (Better retrieval, typed, tagged.)

  [1] Yes — show me a dry-run first
  [2] Later — I'll run /migrate-memory when ready
```

If [1]: run `/migrate-memory` dry-run after setup completes.

### Execute (Quick Track)

1. Run the setup script:
   ```bash
   cd <target-project-cwd>
   ~/src/claude-contextus/node_modules/.bin/tsx \
     ~/src/claude-contextus/scripts/contextus-setup.ts [--no-embed if needed]
   ```

2. Write minimal `.claude/contextus.jsonc` (only if file doesn't already exist):
   ```jsonc
   // contextus config — edit to override defaults, or run /contextus-setup to reconfigure.
   // Docs: https://github.com/anthonypdawson/claude-contextus/blob/main/examples/contextus.jsonc
   {
   }
   ```
   If user chose transformers in Q1, add `"embedding": { "provider": "transformers" }`.

3. If migration was requested, run dry-run of `/migrate-memory`.

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

Sources active:
  Project context   .claude/context/          (your patterns)
  Project docs      docs/                     ({N} files){if projectDocs}
  User memory       ~/.claude/memory/         (cross-project, {N} files){if userMemory}

What to do next:
  /create-context       capture your first pattern
  /context-search       test what a prompt would retrieve
  /context-status       health dashboard
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

### P2: Embedding Provider

```
Embedding provider — how patterns are vectorized for search.

  [1] Ollama (recommended) — local, private, ~100-400ms per embed
      Status: {REACHABLE / NOT REACHABLE}
      Requires: ollama serve + ollama pull nomic-embed-text

  [2] Transformers.js — in-process ONNX, no external service
      Downloads ~100MB model on first run
      Slightly slower startup, same embedding quality
```

If Ollama unreachable and user picks [1], guide:
```
Start Ollama, then tell me when ready:
  1. ollama serve (in another terminal)
  2. ollama pull nomic-embed-text (one-time, ~270MB)
```

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

  'propose' = suggests via footer, you confirm with /create-context (recommended)
  'silent'  = never proposes (you create manually)
  [propose (recommended)] [silent]
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

### Execute (Power User Track)

1. Write `.claude/contextus.jsonc` with all chosen values:
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
     }
   }
   ```
   Only include sections where the user chose a non-default value. Omit defaults.

2. Run the setup script:
   ```bash
   cd <target-project-cwd>
   ~/src/claude-contextus/node_modules/.bin/tsx \
     ~/src/claude-contextus/scripts/contextus-setup.ts [--no-embed if provider down]
   ```

3. If migration was requested, run `/migrate-memory` dry-run.

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

Config changes take effect immediately — edit .claude/contextus.jsonc or use /configure.
Full calibration: /contextus-setup --tune (needs ~1 week of prompt history).
```

---

## Calibration Mode

Triggered by `/contextus-setup --tune` or chosen during re-run.

```bash
cd <target-project-cwd>
~/src/claude-contextus/node_modules/.bin/tsx \
  ~/src/claude-contextus/scripts/contextus-setup.ts --tune
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
