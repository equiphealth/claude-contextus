# Silent Capture (v2 Feature Design)

**Status**: Design proposal for v2  
**Related**: V2_ROADMAP.md, implementation-proactive-capture.md  
**Context**: Addresses Opus's critique of interruption-heavy capture by shifting review to git workflow

## Problem

Current capture workflow interrupts mid-session with "Should I capture this?" prompts. This violates the zero-interruption principle that makes contextus valuable for retrieval.

Opus's critique: "If you have to ask me every time, you're not being proactive — you're being a chatbot."

## Core Insight

**Git review IS the review mechanism.** We already review code changes in PRs. Context captures are just specialized code changes. Use the existing workflow instead of inventing a new one.

## Design Principle

The CAE doesn't need to be perfectly conservative. It needs to be **good enough that PR review isn't painful**. False positives get reverted; false negatives get manually captured later.

## Capture Flow

```
During work:
  Claude identifies something to capture
  ↓
  Background subagent writes to .claude/context/<category>/
  ↓
  Git commit (if auto-commit enabled for current branch)
  ↓
  Continue work (zero interruption)

At PR time:
  Review git diff .claude/context/
  ↓
  Keep / Edit / Revert like any code change
```

## Configuration

```jsonc
{
  "contextCapture": {
    "mode": "auto-commit",  // auto-commit | staging | disabled
    "autoCommitBranches": ["!main", "!master"],  // Patterns: auto-commit on feature branches, not main
    "includeIndexUpdate": true,  // Also update CONTEXT.md in same commit
    "backgroundExecution": true,  // Use subagent to minimize latency
    "commitMessage": "context: add {topic}",  // Template
    "batchCommits": true  // Multiple captures in one commit (edited/removed during review)
  }
}
```

### Capture Modes

**`auto-commit`** (default on feature branches):
- Write context file
- Update CONTEXT.md index
- Commit immediately
- Zero user interaction

**`staging`** (default on main/master):
- Write context file
- Update CONTEXT.md index
- Leave uncommitted (`git status` shows changes)
- User commits manually

**`disabled`** (conservative teams):
- Footer proposes: `Context: propose: topic-name`
- No auto-write
- User explicitly invokes `/create-context` if desired

### Branch Detection

`autoCommitBranches` uses glob patterns:
- `["!main", "!master"]` — Auto-commit everywhere EXCEPT main/master (default)
- `["feat/*", "feature/*"]` — Auto-commit only on feature branches
- `["*"]` — Auto-commit on all branches
- `[]` — Never auto-commit (always staging mode)

## Implementation Details

### Background Execution

Capture runs in background subagent to minimize latency:

```typescript
// In UserPromptSubmit hook (after main response)
if (shouldCapture(topic)) {
  // Non-blocking
  Agent({
    prompt: `Create context for ${topic}`,
    run_in_background: true,
    isolation: 'worktree' // Avoid conflicts with main session
  });
}
```

User sees: work continues immediately. Subagent writes + commits asynchronously.

**Worktree isolation**: Prevents file conflicts when user and capture agent both edit `.claude/context/` simultaneously.

### Batch Commits

Multiple captures in one session → one commit with multiple files:

```bash
context: add generic-examples-only, injection-floor-rationale, lancedb-api-notes

- decisions/decision-generic-examples-only.md
- implementation/implementation-injection-floor.md
- reference/reference-lancedb-api-surface.md
- CONTEXT.md (index updates)
```

Acceptable because:
- PR review happens anyway (can edit/remove individual files)
- Git history stays manageable (not one commit per minor insight)
- Easy to bisect if needed (`git show` reveals all captures in that session)

### Index Updates

`includeIndexUpdate: true` → also edit `CONTEXT.md`:

```diff
## Decisions

+ - [generic-examples-only](decisions/decision-generic-examples-only.md) — Docs must use generic placeholders, not real project names
```

Keeps index in sync without manual maintenance.

### No Session-End Batching

**Rejected design**: Collect proposals during session, commit all at end.

**Why rejected**:
- Adds complexity (track proposals across session)
- Delayed commits harder to attribute to specific conversations
- Session-end hooks are best-effort (user can `/clear` or exit without triggering)

**Chosen design**: Immediate capture (auto-commit) or prompt each time (disabled mode). No middle ground.

## Review Workflow

### Solo Dev (contextus dogfooding)

```bash
# Auto-commit on feature branch
git log --oneline .claude/context/
# 3f8a2c1 context: add generic-examples-only
# 7d4e5f2 context: add injection-floor-rationale

# Quick scan of diffs
git show 3f8a2c1

# Keep, edit, or revert
git revert 3f8a2c1  # if wrong
```

### Team PR Review

```bash
# Context captures show in PR diff
Files changed:
  .claude/context/decisions/decision-generic-examples-only.md  +47
  .claude/context/CONTEXT.md                                    +1

# Reviewer comments on PR:
"Looks good, but let's clarify the 'Why' section"

# Author edits in next commit:
git add .claude/context/decisions/decision-generic-examples-only.md
git commit --amend
```

Context changes reviewed alongside code changes. No separate review process needed.

## Audit Trail

Git becomes the audit trail for Claude's learning:

```bash
# What did Claude learn this week?
git log --since="1 week ago" .claude/context/

# When did we decide X?
git log --all --grep="generic-examples" .claude/context/

# Who captured this pattern?
git blame .claude/context/decisions/decision-generic-examples-only.md
```

Team-visible: colleagues see Claude's reasoning evolution.

## CAE Role Shift

**Current (conservative)**: Filter aggressively to avoid interrupting user. Low recall, high precision.

**v2 (liberal)**: Capture anything plausibly useful. High recall, accept some false positives.

**Why this works**: PR review catches noise. False positives are cheap (revert one file). False negatives are expensive (pattern lost, re-discovered later).

## Open Questions (Pre-Implementation)

1. **Conflict resolution**: If background capture agent and user both edit same file, who wins?
   - **Answer**: Worktree isolation prevents this. Capture agent merges its worktree back only if no conflicts.

2. **Capture latency**: Background agent takes 10-30s. What if user `/clear` before it finishes?
   - **Answer**: Agent continues in background. Commit appears in git history after session ends. User sees it on next `git status`.

3. **CAE confidence threshold**: Capture everything, or only high-confidence proposals?
   - **Answer**: TBD. Start with "high confidence only" (≥0.7), tune based on PR review noise.

4. **Index update failures**: What if CONTEXT.md has merge conflicts?
   - **Answer**: Capture file still writes. Index update skipped, manual fix required. Log warning.

5. **Commit attribution**: Git author is user, but content written by Claude. How to indicate?
   - **Answer**: Commit message prefix `context:` signals Claude-captured. Git author stays user (they approved via config).

## Implementation Phases

**Phase 1** (minimal viable):
- `mode: "staging"` — Write files, don't commit
- Manual `git add` / `git commit`
- Validate end-to-end workflow

**Phase 2** (auto-commit):
- `mode: "auto-commit"`
- Branch detection (`autoCommitBranches`)
- Commit message templating

**Phase 3** (background execution):
- Subagent with `run_in_background: true`
- Worktree isolation
- Latency measurement

**Phase 4** (hardening):
- Conflict resolution
- Index update failure handling
- CAE confidence tuning

## Success Metrics

**Adoption**: % of users with `mode: "auto-commit"` enabled

**Quality**: 
- PR revert rate (% of auto-captured contexts reverted during review)
- Target: <10% revert rate (90% of captures are keeper or edited, not deleted)

**Interruptions**:
- Zero mid-session prompts for capture decisions
- Background latency <30s (p95)

## Risks

**Risk**: CAE captures too aggressively → noisy PRs → users disable feature

**Mitigation**:
- Start conservative (high confidence threshold)
- Tune based on revert rate metrics
- Easy to disable per-project (`mode: "disabled"`)

**Risk**: Background agent conflicts with user edits

**Mitigation**:
- Worktree isolation by default
- Agent checks for conflicts before merging back
- Falls back to staging mode on conflict

**Risk**: Users forget to review captured contexts in PRs

**Mitigation**:
- Pre-commit hook highlights new `.claude/context/` files
- PR template includes "Review captured contexts" checklist
- Git diff shows context changes prominently

## Why This Addresses Opus's Critique

**Opus's concern**: "Asking mid-session breaks flow. If you're asking, you're not being proactive."

**This design**:
- Zero mid-session interruptions (auto-commit mode)
- Review happens async in existing workflow (PR review)
- Git audit trail shows learning over time
- False positives are cheap to fix (revert/edit in PR)
- Shifts burden from "be perfectly conservative" to "be useful enough that review isn't painful"

Opus wanted proactive context delivery. This enables proactive context **capture** to match.

## Related Work

- `implementation-proactive-capture.md` — Current CAE-based proposal system (v1)
- `V2_ROADMAP.md` — Backlog placement for this feature
- `reference-opus-metrics-critique.md` — Original critique that motivated rethinking capture flow
