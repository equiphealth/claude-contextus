# Silent Capture (v2 Feature Design)

**Status**: Design proposal for v2  
**Related**: V2_ROADMAP.md, implementation-proactive-capture.md  
**Context**: Addresses Opus's critique of interruption-heavy capture by shifting review to git workflow

## Problem

Current capture workflow interrupts mid-session with "Should I capture this?" prompts. This violates the zero-interruption principle that makes contextus valuable for retrieval.

## Core Insight

**Git IS the quality gate.** Context captures are just files in `.claude/context/`. They get reviewed the same way code does — at `git add` time, at commit time, at PR review time. No new process needed.

This means the CAE doesn't need to be perfectly conservative. False positives are cheap (drop a file from your commit). False negatives are expensive (pattern lost, re-discovered later). So the CAE can be liberal.

## Design

During work, Claude writes context files silently to `.claude/context/<category>/`. No prompt, no interruption. The files appear in `git status` as untracked/modified. You decide what to commit, same as any other file.

```
During work:
  Claude identifies something worth capturing
  ↓
  Writes .claude/context/<category>/<file>.md
  ↓
  Updates CONTEXT.md index
  ↓
  Continue work (zero interruption)

At commit/PR time:
  git status shows new context files
  ↓
  You decide what to git add (the gate)
  ↓
  Context ships with the code it documents
```

## Configuration

```jsonc
{
  "contextCapture": {
    "mode": "staging",           // auto-commit | staging | disabled
    "autoCommitBranches": ["!main", "!master"],
    "commitMessage": "context: add {topic}",
    "batchCommits": true
  }
}
```

### Modes

**`staging`** (default):
- Claude writes context files silently
- Files show up in `git status` as untracked
- You `git add` what belongs with the current work
- Leftovers carry forward to the next commit naturally
- The gate is your normal staging workflow

**`auto-commit`** (for repos/users who prefer it):
- Claude writes + commits immediately
- Commit message uses `context:` prefix
- Context shows up in PR diff alongside code
- Review happens at PR time — drop what doesn't belong
- Good for: solo devs, repos where context always relates to the branch work

**`disabled`** (conservative teams):
- Footer proposes: `Context: propose: topic-name`
- No auto-write
- User explicitly invokes `/create-context`
- Current v1 behavior preserved

### Branch Detection (auto-commit mode)

`autoCommitBranches` uses glob patterns:
- `["!main", "!master"]` — Auto-commit everywhere EXCEPT main/master (default)
- `["feat/*", "feature/*"]` — Only on feature branches
- `["*"]` — All branches
- `[]` — Never (falls back to staging)

## Why Context Belongs in PRs

Context captured during a feature branch documents the decisions of that feature:

```
src/auth/token-refresh.ts          +142
src/auth/token-refresh.test.ts      +87
.claude/context/decisions/decision-token-refresh-strategy.md  +23
```

The context file explains *why* the code looks the way it does. Reviewers get more signal, not noise.

For captures that don't relate to the PR's work — drop them from the commit. They stay untracked, waiting for the right PR. Same workflow as dropping an unrelated refactor that snuck in.

## CAE Role Shift

**v1 (conservative)**: Filter aggressively to avoid interrupting user. Low recall, high precision.

**v2 (liberal)**: Capture anything plausibly useful. High recall, accept false positives.

**Why this works**: The cost of a false positive drops from "broke my flow" (mid-session prompt) to "I don't `git add` one file." The quality bar shifts from "definitely worth capturing" to "probably worth capturing" — corpus fills faster, retrieval has more to work with sooner.

### Confidence Threshold

Start with ≥0.7 confidence for auto-capture. Tune based on:
- How often users drop captured files (too aggressive → lower threshold generates noise)
- How often users manually `/create-context` something the CAE missed (too conservative)

## Embedding Behavior

The daemon can embed from working tree regardless of commit status. A captured file is retrievable immediately — it doesn't need to be committed first. This means:

- Staging mode: captured context helps the current session even before commit
- Auto-commit mode: same, but also persisted in git immediately
- Disabled mode: nothing to embed until user runs `/create-context`

## Audit Trail

Git becomes the audit trail for Claude's learning:

```bash
# What did Claude learn this week?
git log --since="1 week ago" -- .claude/context/

# When did we decide X?
git log --all --grep="context:" -- .claude/context/

# Which captures shipped with which feature?
git log --oneline -- .claude/context/ src/feature/
```

## Success Metrics

**Quality**:
- Drop rate: % of auto-captured files that users don't commit
- Target: <20% drop rate (80%+ of captures are keepers)

**Interruptions**:
- Zero mid-session prompts for capture decisions

**Corpus growth**:
- Rate of new context files vs. v1 (expect 3-5x with liberal CAE)

## Risks

**Risk**: CAE captures too aggressively → cluttered `git status`

**Mitigation**: Start conservative (0.7 threshold), tune down. Easy to `git clean` context files if it gets noisy. Users can switch to `disabled` mode per-project.

**Risk**: Users forget captured files exist, never commit them

**Mitigation**: Not a problem — they still get embedded and help retrieval. Eventually they get committed with related work or cleaned up. No urgency.

**Risk**: Stale captures accumulate in working tree

**Mitigation**: `/audit-context` already handles staleness detection. Untracked files that sit for weeks without being committed are candidates for deletion.

## Why This Diverges from Opus's Recommendation

**Opus said**: Keep the prompt. User should explicitly approve each capture.

**This design says**: Git workflow is a better gate than mid-session prompts because:
- Review happens async (doesn't break flow)
- Uses existing workflow (no new process)
- Team-visible in PRs (colleagues see and review captures)
- Easy to fix (don't add, or revert)
- Zero new tooling required (it's just files and git)

**Trade-off accepted**: More false positives in the working tree, zero interruptions during work, quality maintained via normal git staging/review.

## User-Level Capture (cross-project patterns)

User-level context (`~/.contextus/context/`) isn't in a git repo by default, so the
"git is the gate" principle doesn't apply. Three complementary mechanisms provide the
quality gate instead:

### 1. Visibility footer

After writing a user-level capture, Claude emits:
```
Context: captured [user]: ~/.contextus/context/reference/reference-foo.md
```
The `[scope]` tag (`user` or `project`) disambiguates where the file landed — the path alone doesn't always make that obvious (e.g. a relative project-scope path like `gotchas/gotcha-foo.md` looks identical in shape to a user-scope one). This ensures the user sees both what was written and where, even though there's no `git status` to surface it for user-scope captures.

### 2. Captures log

Every silent capture (project or user-level) appends to `~/.contextus/captures.log`:
```
2026-06-21T14:32:00Z | user | reference/reference-foo.md | "cross-project auth pattern"
2026-06-21T14:35:00Z | project:my-app | gotcha/gotcha-bar.md | "timezone footgun"
```
Gives an audit trail without git. `/audit-context` can review periodically.

### 3. Git-init recommended at setup

`/contextus-setup` offers `git init ~/.contextus/context/` as an optional step during
first-run onboarding. Users who opt in get the full git-gate workflow for user-level
captures too (stage, commit, review). Users who don't still get (1) + (2).

### Future: probation via usage tracking (v2 Track-B)

When calibration-mode usage evaluation lands, new user-level captures can be tagged
provisional. If retrieved but never *used* across N sessions, `/audit-stale` flags them
for review. This requires the usage signal infrastructure — deferred until then.

## Routing: project vs. user-level

The model decides where to write based on the insight's scope:

| Signal | Route to |
|--------|----------|
| Specific to this codebase (architecture, decisions, gotchas) | `.claude/context/` (project) |
| Applies across projects (tool patterns, personal workflows, universal gotchas) | `~/.contextus/context/` (user) |
| Team convention that colleagues should see | `.claude/context/` (project, committed) |
| Personal preference (editor config, style choices) | `~/.contextus/context/` (user) |

The staging footer instruction makes this routing explicit. The model already makes this
judgment (same reasoning as "global memory vs. project memory?"), it just needs the
instruction to act on it.
