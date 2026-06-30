# Capture Philosophy

Guidelines for what belongs in `.claude/context/` and what doesn't.

## Core Principle

**Capture durable technical knowledge that helps future sessions.** Skip temporary project management state.

## What to Capture

### ✅ Technical Patterns
- Architecture decisions with "why" (not just "what")
- Non-obvious failure modes (gotchas)
- Implementation patterns that recur
- Tradeoffs with context (when/why you chose X over Y)

**Example:** `gotcha-unified-db-scoping-invariant.md` — Every DB operation must scope by projectId or data leaks across projects.

### ✅ Domain Knowledge
- Business logic patterns
- API contracts and invariants
- Data flow patterns
- Security constraints

**Example:** `schema-user-context-sources.md` — How user/project/docs sources are prioritized in retrieval.

### ✅ Workflow Knowledge
- Build/test/deploy patterns specific to this codebase
- Tool configurations and why they're set that way
- Migration procedures

**Example:** `reference-migration-system.md` — How to coordinate breaking changes across 5 files.

### ✅ Historical Context (When Actionable)
Decisions are worth capturing if they have **technical depth**:
- They explain surprising code ("why is this async when it doesn't need to be?")
- They prevent future re-litigation ("we tried X, here's why it failed")
- They document constraints ("this API must stay stable for backward compat")
- They explain **what was evaluated** and **why one option won**
- They state **conditions for reevaluation**

**Good example:** `decision-use-lance-over-chroma.md`
```markdown
Evaluated: LanceDB vs Chroma vs pgvector
Chose Lance because:
  - Disk-based (low memory footprint at scale)
  - SQL-like filtering (better than Chroma's dictionary filters)
  - TypeScript support (Chroma was Python-first)
Tradeoff: Less mature ecosystem, but better for our embedding scale
Reconsider if: Need distributed search OR Lance stops Node.js support
```

**Bad example (skip):** `decision-defer-scripts-reorganization.md`
```markdown
We discussed reorganizing scripts/ during PR #26.
Decided to defer to v2 because: not urgent, wrong timing.
See issue #27 for the work.
```
**Why skip:** No technical depth — just timing/prioritization. Already tracked in issue. No durable knowledge for future sessions.

## What NOT to Capture

### ❌ Project Management
- Task prioritization ("defer X to v2")
- Timeline decisions ("ship this in Q3")
- Who's working on what
- PR/issue discussions that don't reveal technical insights

**Why skip:** Already tracked in issues/PRs/git history. Short shelf life.

**Example to skip:** "Decision to defer scripts/ reorganization" — just timing, no technical insight. The work itself is in issue #27.

### ❌ Temporary State
- Current work-in-progress
- "We're investigating X"
- Intermediate findings (wait for conclusion)
- Debugging notes (unless they reveal a gotcha)

**Why skip:** Changes daily. Corpus is for durable knowledge, not session state.

### ❌ Already-Documented Info
- Anything in README, CONTRIBUTING, or existing docs
- Code comments that are sufficient
- Type definitions that are self-explanatory

**Why skip:** Duplication creates drift. Link to the source of truth instead.

**Exception:** If docs are incomplete/outdated and you're adding missing context, capture the gap and propose updating the docs.

### ❌ Obvious Information
- "TypeScript requires types" — not a gotcha
- Standard library usage
- Common patterns everyone knows

**Why skip:** Corpus isn't a tutorial. Capture the non-obvious.

## Edge Cases

### "Is this decision worth capturing?"

Ask:
1. **Durability:** Will this matter in 6 months?
2. **Surprise factor:** Would a future dev wonder "why is this like this?"
3. **Recurrence:** Will this pattern come up again?
4. **Already tracked:** Is this in an issue/PR/commit message?

If 1-3 are YES and 4 is NO → capture it.

### "Is this a gotcha or just a bug fix?"

**Gotcha** = systemic issue that can recur  
**Bug fix** = one-time mistake

Capture the gotcha pattern, not the specific bug instance.

**Example:**
- ❌ "Bug: forgot to pass projectId to deleteByFilename()"
- ✅ "Gotcha: Every unified DB operation must scope by projectId"

### "This is a long explanation — capture or just answer?"

**Capture if:**
- You're explaining the same thing twice (already a recurrence)
- The explanation has "why" not just "what"
- It's non-obvious from reading the code

**Keep in chat if:**
- It's specific to this user's question
- It's basic "how to use X" covered in docs
- You're just walking through code execution

## Quality Bar

### Minimal Captures (Don't Do This)
```markdown
# Auth Flow
We use JWT tokens.
```
**Problem:** No "why," no context, obvious from code.

### Good Captures
```markdown
# Auth Token Refresh Strategy

We refresh tokens eagerly (on startup + every 50min) rather than 
on-demand (wait for 401, retry).

## Why Eager

On-demand refresh creates UX jank:
- User action triggers request
- Request fails with 401
- Refresh blocks for 2-3s (network round-trip)
- Original request retries
- Total: 3-5s perceived latency on "random" requests

Eager refresh keeps tokens fresh proactively, so requests never see 401s.

## Tradeoff

- Pro: Zero user-visible refresh latency
- Con: Wastes ~1 refresh/hour when user is idle
- Con: Adds daemon wakeup complexity

We chose UX over efficiency. Bandwidth cost is negligible (~1KB/hour).

## When to Reconsider

If we add offline support, eager refresh won't work (no network).
Switch to on-demand with optimistic pre-fetching.
```

**Good because:** Explains why, documents tradeoff, states conditions for change.

## Integration with Git

In **staging mode** (current default):
- Captures appear as untracked files
- You `git add` what relates to your current work
- Leftovers stay for the next relevant commit
- **The gate is your normal git workflow**

False positives are cheap — just don't stage them. Bias toward capturing.

## Meta: Evolving This Doc

This doc itself should evolve based on real captures that turned out to be noise. If you find yourself repeatedly removing certain kinds of captures, add an anti-pattern here.

**Living document — update it when patterns emerge.**
