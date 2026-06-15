# TODO: User Documentation

**Status:** Not started — this is the **"Docs & DX" milestone**, a deliberate phase
*before* true v1.1 (packaging/GitHub-install). It's the "make it usable by someone who
isn't us" layer. (User framing, 2026-06-15.)
**Priority:** High  
**Created:** 2026-06-15

---

## ⚠️ CORRECTIONS FROM DOGFOODING (2026-06-15) — read before writing any doc

The plan below predates the automation-migration dogfood. Several assumptions are now
KNOWN WRONG and would mislead users. Full detail: `docs/MIGRATION_LESSONS.md`. Fix these
when writing:

1. **Install is `--plugin-dir`, NOT `claude plugin install`.** GitHub/marketplace install
   is a **v1.1** milestone (see PACKAGING.md). The v1 invocation is
   `claude --plugin-dir ~/src/claude-contextus`. The quick-start's "3-command setup"
   (lines ~26-31) is aspirational — mark it v1.1 or rewrite for `--plugin-dir`.
2. **Node 22, not "18+"** (line 25). And the version matters: the repo needs Node 22, so
   `pnpm`-based invocations FAIL on a mismatched shell. **Scripts must be run via the
   repo-local tsx by path**, never `pnpm`/`pnpm --prefix`:
   `cd <project> && ~/src/claude-contextus/node_modules/.bin/tsx <repo>/scripts/<x>.ts`.
   (`pnpm --prefix` is doubly wrong — it sets cwd to contextus and embeds the wrong corpus.)
3. **Per-project config is now a thing (built 2026-06-15) — the "Sources" + "Calibration"
   sections must cover it.** Config resolves through 3 tiers (later wins): global
   `plugin.json` → machine-local `~/.contextus/data/<project>/config.json` (where
   `--apply` writes) → git-committed `<project>/.claude/contextus.json` (team-shared, WINS).
   `/context-calibrate --floor --apply` is now PER-PROJECT — it no longer touches the
   global floor. The "Tuning Knobs" section must explain a floor is per-project.
4. **The `Context: used:` footer is daemon-generated + whitelisted** (not Claude reciting
   from memory — that caused hallucinated filenames before the fix). Doc it as trustworthy.
5. **Skills currently carry STALE knowledge** (say `pnpm`, point at non-working commands)
   — the Docs & DX milestone MUST include a **skill-refresh pass** (every skill that
   shells out → tsx-by-path) and likely a **`/contextus-doctor`** skill (diagnoses:
   wrong-corpus-embedded, below-floor false negatives, hallucinated footer, the
   phantom-reembed). These are DX work items, not just prose.
6. **Dilution is real** — terse prompts retrieve worse than natural-language questions
   (measured). The "understanding injections" section should tell users to ask naturally,
   not in keywords. And note embeddings fail short exact-term queries (e.g. `getLogger`)
   until v2 hybrid search.

---

## Problem

Contextus has strong internal/developer docs (DESIGN.md, BUILD_LOG, skill READMEs) but lacks user-facing documentation. Gap between "how it works internally" and "how do I actually use this thing."

Current state:
- Skills have implementation details, not usage guidance
- No quick-start guide for new users
- No mental model explanation (context vs docs vs memory?)
- Calibration process documented but not explained
- Day-to-day workflows unclear

## What to Create

### 1. Quick-Start Guide (`docs/quick-start.md`)

**Goal:** Get from zero to first injection in <5 minutes.

**Content:**
- Prerequisites (Claude Code, Node 18+, Ollama if using local embeddings)
- 3-command setup:
  ```bash
  claude plugin install claude-contextus
  # Start new session in a project
  /contextus-setup
  ```
- First injection example (show it working)
- "What just happened?" explanation
- Verification: "How do I know it's working?"
- Troubleshooting: "Daemon won't start" / "No injections"
- Next steps → day-to-day guide

**Success criteria:** A new user sees their first relevant injection within 5 minutes.

### 2. Day-to-Day Usage Guide (`docs/usage.md`)

**Goal:** Answer "what should I actually do?"

**Content:**

#### Creating Context
- When to use `/create-context` vs auto-capture
- Context file structure (categories, types, tags)
- Naming conventions for context files
- When to force-new vs update existing

#### Working with Context
- How to search: `/context-search <pattern>`
- How to audit: `/audit-context`, `/audit-stale`
- How to update: `/update-context`
- Tag management: `/tag-context`

#### Understanding Injections
- How to read injections (tagged with similarity scores)
- "Context: used:" footer — what is it?
- When context is NOT injected (below threshold)

#### Sources Explained
- **Project context** (`.claude/context/`) — Patterns, decisions, gotchas
- **Project docs** (`docs/`) — Reference documentation
- **User memory** (`~/.claude/memory/`) — Cross-project preferences
- **User docs** (`~/.claude/docs/`) — Personal reference

#### Maintenance
- When to rebuild embeddings (`/rebuild-embeddings`)
- Keeping context fresh (`/audit-stale`)
- Migration from old memory system (`/migrate-memory`)

**Success criteria:** Users understand the capture/retrieve/tune lifecycle.

### 3. Calibration & Tuning Guide (`docs/calibration.md`)

**Goal:** Turn generic system into *your* system.

**Content:**

#### Why Calibrate?
- Out-of-box settings are generic
- Your corpus determines optimal thresholds
- Calibration = data-driven tuning

#### The Lifecycle
```
Install → Use for 1 week → Floor calibration → Use for 2-4 weeks → Usage-eval refinement
```

#### Floor Calibration (Cold-Start)
- **When:** After initial corpus build (1 week of use)
- **What:** Replay historical prompts, find optimal injection threshold
- **How:** `/context-calibrate --floor`
- **Output:** Trade curve (floor → injection rate)
- **Decision:** Pick your injection rate (precision vs recall)
- **Apply:** `/context-calibrate --floor --apply`

#### Usage-Eval Refinement (Ongoing)
- **When:** After 2-4 weeks of use
- **What:** Haiku judges whether injected patterns were actually used
- **How:** `/context-calibrate --start` (runs for 100 prompts)
- **During:** Check progress with `/context-calibrate --status`
- **After:** View report with `/context-calibrate --report`
- **Recommendations:** 
  - Raise/lower floor based on unused rate
  - Prune low-performers
  - Boost high-performers
  - Adjust topK

#### Tuning Knobs Explained
- `injectionFloor` — Gate: inject anything at all?
- `similarityThreshold` — Filter: include this result?
- `topK` — How many patterns to retrieve?
- `maxTokens` — Token budget per injection

#### When to Re-Calibrate
- After major corpus changes (migration, deletions)
- Every 3-6 months (corpus drift)
- When switching embedding models
- When retrieval feels wrong (too noisy / too sparse)

#### Troubleshooting Calibration
- "No historical prompts found" → Use for a week first
- "Recommended floor is 0.05" → Corpus is too small/generic
- "Injection rate is 0%" → Floor is too high
- "Usage-eval shows 80% unused" → Lower floor or prune corpus

**Success criteria:** Users run calibration at right times and understand trade-offs.

### 4. Mental Model Explainer (integrate into above docs)

Don't make this a separate doc — sprinkle throughout quick-start and usage guide.

**Key concepts to explain:**
- Vector embeddings (non-technical: "semantic search")
- Similarity scores (0-1, what do they mean?)
- Injection vs retrieval vs capture (the three modes)
- Auto-capture proposal workflow
- Why calibration matters (generic → personalized)

## Documentation Structure

```
claude-contextus/
├── README.md (overview + install + quick links)
├── docs/
│   ├── quick-start.md (5min to first injection)
│   ├── usage.md (day-to-day workflows)
│   ├── calibration.md (tuning guide)
│   ├── DESIGN.md (existing — developer-focused)
│   ├── BUILD_LOG.md (existing — implementation history)
│   └── MIGRATION_GUIDE.md (existing — from old memory system)
├── skills/ (existing — implementation-focused READMEs)
└── TODO-user-documentation.md (this file)
```

## README Overhaul

Current README is installation-focused. Needs:
1. **The Pitch** — What problem does this solve?
2. **Quick Example** — Show a before/after (no context → context injected)
3. **Install** — 2 commands
4. **Quick Start** → Link to `docs/quick-start.md`
5. **Features** — Bullets: auto-capture, semantic retrieval, calibration
6. **Documentation** — Links to usage, calibration, design docs
7. **Troubleshooting** — Common issues + `/context-doctor`

## Success Metrics

How do we know this worked?

1. **New user can set up in <10 minutes** without asking for help
2. **Day-to-day guide answers 80% of "how do I...?" questions**
3. **Users run calibration at the right time** (not too early, not skipped)
4. **Support questions shift from** "how do I use this?" **to** "can I do X?"

## Implementation Notes

- Start with quick-start (highest impact)
- Get user feedback before writing calibration guide (validate assumptions)
- Use actual examples from automation corpus (real injections, real calibration output)
- Screenshots/terminal output for "what it looks like" sections
- Link liberally between docs (don't duplicate)

## Non-Goals

- API reference docs (skills already document their args/flags)
- Architecture deep-dives (DESIGN.md covers this)
- Implementation internals (BUILD_LOG covers this)
- Migration from every possible system (MIGRATION_GUIDE covers old memory → contextus)

Keep focused on **user workflows**, not implementation details.

---

_Created: 2026-06-15_  
_Last updated: 2026-06-15_
