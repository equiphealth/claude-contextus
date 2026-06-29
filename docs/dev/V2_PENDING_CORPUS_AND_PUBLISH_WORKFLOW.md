# Contextus V2 Design Specification
## Unified Semantic Corpus Evolution, Pending State, and Publication Workflow

*Status:* **Draft** (ready for implementation review)  
*Last Updated:* 2026-06-28  
*Core Principle:* **Capture now, publish later — isolate semantic evolution from code evolution.**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Impact on Existing Users](#impact-on-existing-users)
3. [Glossary](#glossary)
4. [Problem Statement](#problem-statement)
5. [Architecture](#architecture)
6. [Semantic State Model](#semantic-state-model)
7. [Configuration](#configuration)
8. [Pending Corpus Storage](#pending-corpus-storage)
9. [Publish Workflow](#publish-workflow)
10. [Git Implementation Details](#git-implementation-details)
11. [Local Materialization Strategy](#local-materialization-strategy)
12. [Conflict Resolution](#conflict-resolution)
13. [Failure Recovery & Rollback](#failure-recovery--rollback)
14. [CLI & UX](#cli--ux)
15. [Team Git Gating](#team-git-gating)
16. [Feature Integration](#feature-integration)
17. [Migration from V1](#migration-from-v1-solo--team-mode)
18. [Implementation Roadmap](#implementation-roadmap)
19. [Open Questions](#open-questions)
20. [Safety Rules](#safety-rules)
21. [Appendices](#appendices)

---

## Executive Summary

Contextus continuously evolves a **semantic corpus** (patterns, runbooks, architecture notes, decisions) under `.claude/context/` and `.claude/contextus/`. This corpus changes frequently due to silent capture, transcript mining, CAE evaluation, and team edits.

**Problem:** Publishing corpus changes to feature branches pollutes PRs, creates merge noise, and breaks branch isolation during active development.

**Solution:** A dedicated **context branch** (configurable, default: `contextus/main`) holds all published corpus. During development, semantic updates are **buffered in pending corpus state** rather than immediately committed. When ready, developers explicitly publish pending changes to the context branch via a deliberate, reviewable workflow.

**Three-tier model:**
1. **Ephemeral state** — transient session data (in-memory, discardable)
2. **Pending corpus state** — durable but unpublished changes (local storage, resumable across sessions)
3. **Published corpus state** — authoritative corpus in Git (shared, reviewable, permanent)

**Two operating modes:**
- **Solo mode** (default) — Current V1 behavior preserved. Capture writes directly to `.claude/context/` on the working branch. No pending layer, no context branch, no publish ceremony. Ideal for individual pilots and early adoption.
- **Team mode** (opt-in) — Full pending/publish workflow with context branch isolation, PR gating, and conflict resolution. Activated by setting `publishMode` to any value other than `"none"`.

**Benefits:**
- ✅ Code branches stay clean (no corpus noise) *[team mode]*
- ✅ Developers stay on code branches (no forced context branch switches)
- ✅ Corpus evolution is deliberate and reviewable (Git PR gates) *[team mode]*
- ✅ CAE and mining can run aggressively without disruption
- ✅ Publish operations are repeatable and recoverable
- ✅ Solo users experience zero friction (V1 behavior preserved)
- ✅ Migration from solo → team is non-breaking (existing corpus becomes initial publish)

---

## Impact on Existing Users

### What does NOT change (solo mode, default)

| Aspect | V1 Behavior | V2 Solo Mode |
|--------|-------------|--------------|
| Capture | Writes to `.claude/context/` | Same |
| Retrieval | Reads from `.claude/context/` + vector DB | Same |
| Git | Context committed on code branches | Same |
| Latency | ~63ms retrieval | Same |
| Config | `.claude/contextus.jsonc` | Same |

**Solo users experience zero change on upgrade.** The pending/publish layer does not activate unless `publishMode` is set to something other than `"none"`.

### What changes (team mode, opt-in)

| Aspect | Solo Mode | Team Mode |
|--------|-----------|-----------|
| Capture | Direct write | Pending op + local materialization |
| Git | Committed on code branch | Gitignored on code branch; published to context branch |
| Retrieval | Local `.claude/context/` | Published corpus + pending overlay |
| Sharing | Via normal branch merges | Via context branch + PR review |
| Fresh clone | Context present in repo | `contextus pull` needed (or session-start hook) |

---

## Glossary

**Archive branch** — Dedicated Git branch (e.g., `contextus/archive`) for archived/superseded entries. Kept separate from active corpus to maintain cleanliness.

**Base context commit** — The SHA of the context branch HEAD at session start. Used for drift detection and conflict resolution.

**Code branch** — Development branch (`main`, `feature/*`, `hotfix/*`). Contains source code, tests, configs. Must not receive direct corpus mutations.

**Context branch** — Dedicated branch (e.g., `contextus/main`) that holds published semantic corpus. All shared corpus changes land here. Never modified by normal development.

**Context Applicability Evaluator (CAE)** — Subsystem that evaluates corpus relevance and (in Phase 3) proposes removals/archives/supersessions.

**Contextus daemon** — Background process monitoring session state, triggering pending captures and publish workflows.

**Corpus** — Semantic knowledge base: entries, metadata (tags, ratings), relationships (supersessions, archival status).

**Dry-run publish** — Preview mode (`contextus publish --dry-run`) showing proposed changes without applying them.

**Local materialization** — The process of writing pending operations to browseable `.claude/context/` files on disk (gitignored on code branches).

**Manifest** — JSON file (`.claude/contextus/pending/manifest.json`) tracking session state, base commit, pending operation count.

**Operation / Pending operation** — A granular semantic mutation (add-entry, update-entry, archive-entry, etc.). Stored durably before publishing.

**Pending corpus state** — Durable but unpublished changes stored in `.claude/contextus/pending/`. Lives machine-locally, not Git-committed.

**Pending overlay** — Optional retrieval mode that merges published corpus with pending entries for local session awareness.

**Publish batch** — A frozen set of pending operations published in a single Git commit. Idempotent, replayable, resumable.

**Published corpus state** — Authoritative corpus committed to the context branch. Shared, reviewable, subject to CI and PR policy.

**Publish mode** — When pending corpus is published: `manual` (explicit command), `session-end` (at IDE/shell close), or `scheduled` (cron-like).

**Publish topology** — How published changes are shared: `direct-commit` (straight to context branch), `pr` (via pull request), or `bot-mediated` (bot creates PR).

**Retrieval** — Process of fetching relevant corpus entries. Defaults to published corpus; optional pending overlay includes in-progress work.

**Semantic state** — The three-tier model: ephemeral (session-local) → pending (durable, unpublished) → published (Git-committed, shared).

**Silent capture** — Automatic semantic observation during development (e.g., recognizing a runbook from code comments). Emits pending operations.

**Sparse worktree** — Git worktree with only `.claude/` directories checked out (via `git sparse-checkout`), minimizing disk and network overhead.

**Work branch** — The Git branch a developer was on before publish. Always saved and restored after publish to avoid stranding the user.

---

## Problem Statement

### Current State Issues

1. **Git pollution** — Semantic corpus changes land on feature branches, polluting PRs with irrelevant diffs
2. **Merge conflicts** — Multiple developers' corpus changes conflict, requiring manual resolution
3. **Branch isolation broken** — Silent capture or mining force commits to code branches, violating isolation
4. **Developer disruption** — Users are unexpectedly switched to context branch during publish, disrupting coding flow
5. **No review gate** — Corpus changes bypass team review processes
6. **CAE/mining unsafe** — Running aggressive corpus mutation features risks accidental commits

### Design Goals

**Primary:**
- Isolate semantic evolution from code evolution
- Avoid disrupting active development
- Preserve Git as quality gate for shared corpus
- Support reviewable, deliberate publication
- Make CAE/mining safe

**Secondary:**
- Global and per-project configuration
- Clear CLI and IDE visibility
- Team policy enforcement (require review before publication)
- Safe, non-destructive failure recovery
- Scale cleanly to teams and multi-project setups

---

## Architecture

### Parallel Git Histories

**Code Branches** (normal development)
- `main`, `feature/*`, `hotfix/*`, `release/*`
- Contain: source code, tests, configs, infra, docs
- Normal development flow
- **Do NOT receive corpus mutations** (except local gitignored working copy)

**Context Branches** (semantic corpus)
- `contextus/main`, `contextus/archive`, `contextus/experimental`
- Contain: `.claude/context/**`, `.claude/contextus/**`, auto-docs (if configured)
- All **published** semantic changes land here
- Subject to team review (PR gate, CI, branch protection)

**Pending Corpus State** (bridge between development and publication)
- Local storage under `.claude/contextus/pending/`
- Durable across sessions but not committed to Git
- Represents changes detected/staged but not yet published
- Machine-local only (not synchronized between developers)

### Data Flow

```
Code branch (e.g., feature/my-work)
  ↓
Silent capture → create pending op + materialize .claude/context/ (gitignored)
  ↓
.claude/contextus/pending/ (durable, unpublished)
  ↓
contextus publish → create sparse worktree, sync corpus, validate, commit
  ↓
Context branch (e.g., contextus/main) → PR review → merge
  ↓
Published corpus (shared, authoritative)
```

### Key Architectural Principle

> **Developers never need to manually switch branches during normal development. The daemon handles branch switching only during explicit publish operations, and always restores the original branch afterward.**

---

## Semantic State Model

### 3.1 Local Ephemeral State

**Lifetime:** Active session or process only

**Examples:**
- Recently captured observations
- Intermediate classification outputs
- Provisional CAE judgments
- Temporary mining results
- In-memory parse trees

**Properties:**
- Not authoritative
- May be discarded safely
- Does not need to be shared

---

### 3.2 Pending Corpus State

**Lifetime:** Durable across sessions until published or discarded

**Examples:**
- New semantic entries
- Modified entries
- Archive candidates
- Supersession relationships
- Category/tag changes
- Usage metadata updates

**Properties:**
- Durable on-disk storage (`.claude/contextus/pending/`)
- Reviewable before publication
- Not yet authoritative (not shared)
- Must never silently disappear
- Resumable across restarts

**Storage:** `.claude/contextus/pending/` (machine-local, not Git-committed)

---

### 3.3 Published Corpus State

**Lifetime:** Canonical, permanent (Git history)

**Examples:**
- Entries on context branch
- Committed metadata
- Auto-generated documentation
- Category/tag assignments
- Supersession chains

**Properties:**
- Shared and reviewable
- Subject to CI and PR policy
- Used as baseline for future capture
- Authoritative for team workflows
- Immutable once merged (only modifiable via new PRs)

---

## Configuration

### 4.1 Global Configuration

**Location:** `~/.contextus/config.jsonc`

```jsonc
{
  "contextus": {
    "publishMode": "none",                   // "none" (solo), "manual", "session-end", "scheduled"
    "contextBranch": "contextus/main",       // ignored in solo mode
    "archiveBranch": "contextus/archive",    // ignored in solo mode
    "publishTopology": "pr",                 // "direct-commit", "pr", "bot-mediated"
    "publishAtSessionEnd": false,            // Prompt at IDE/shell exit
    "remindOnPendingCorpus": true,           // Show footer if pending exist
    "retrieveWithPendingOverlay": true,      // Include pending in retrieval (see §4.4)
    "requireDryRunBeforePublish": false,     // Force --dry-run review
    "sessionIdleThresholdMinutes": 30,       // Inactivity timeout
    "conflictDefaultResolution": "accept-local-if-newer"  // see §9 Conflict Resolution
  }
}
```

> **Note:** `publishMode: "none"` = solo mode. The pending/publish layer is entirely inactive. Capture writes directly to `.claude/context/` on the current branch (V1 behavior). All team-mode settings (`contextBranch`, `publishTopology`, etc.) are ignored.

### 4.2 Project-Level Override

**Location:** `<project>/.claude/contextus/project.jsonc`

Overrides global config for this project only. Precedence: **project > global > built-in**.

### 4.3 Default Behavior

**Core principle:** Users should never be surprised by unexpected publish behavior.

**Defaults:**
- `publishMode: none` — Solo mode (V1 behavior). No pending layer. No publish ceremony.
- `publishTopology: pr` — When team mode is active, all publishes require PR review
- `publishAtSessionEnd: false` — No auto-publish at session end (respects autonomy)
- `remindOnPendingCorpus: true` — Keep changes visible without forcing action
- `retrieveWithPendingOverlay: true` — Pending entries participate in retrieval (see §4.4)

**Guarantees:**
- ✅ Solo mode is default — existing users experience zero change on upgrade
- ✅ No auto-publish without explicit config
- ✅ No direct commits without opt-in
- ✅ Always restore work branch
- ✅ Always show what's about to publish

### 4.4 Retrieval and Pending Overlay

**Default: `retrieveWithPendingOverlay: true`**

Rationale: In both solo and team mode, newly captured patterns should be immediately retrievable. Setting this to `false` would create a regression where captured knowledge is invisible until a publish ceremony occurs — defeating the "capture now, use immediately" promise.

In team mode with overlay enabled:
- Retrieval merges published corpus (from context branch) with pending entries (local)
- Dedup by entity ID ensures no double-injection
- Pending entries are marked `[pending]` in retrieval provenance footer
- Published version takes precedence if both exist for same entity ID

---

## Pending Corpus Storage

### 5.1 Storage Approach

Pending corpus is stored as an **operation log** (not file diff cache) because:
- Preserves semantic intent (operation type, metadata, reasoning)
- Replayable (deterministic replay against any base state)
- Supports resumable publish (pause and resume without losing state)
- Gives better lineage and conflict tracking
- Scales better for CAE and mining workflows

### 5.2 Disk Layout

```
.claude/contextus/pending/
  manifest.json              # Session state
  ops/                       # Individual operation files
    op-001.json
    op-002.json
  snapshots/                 # Periodic corpus snapshots
    snapshot-2026-06-28T10:30:00Z.json
  logs/                      # Replay logs and audit trail
    replay-batch-001.log
  locks/                     # Lock files (prevent concurrent publish)
    publish.lock
  conflicts/                 # Unresolved conflict records
    conflict-entry-abc.json
```

### 5.3 Manifest

**File:** `.claude/contextus/pending/manifest.json`

```json
{
  "projectId": "unique-project-id",
  "contextBranch": "contextus/main",
  "baseContextCommit": "abc123...",
  "workBranchAtLastMutation": "feature/my-work",
  "pendingOperationCount": 42,
  "publishState": "idle",
  "lastUpdatedAt": "2026-06-28T14:32:00Z",
  "sessionId": "uuid-of-session"
}
```

### 5.4 Operation Files

**Format:** JSON, one operation per file

**Example:**
```json
{
  "opId": "op-001-add-entry-runbook-xyz",
  "type": "add-entry",
  "timestamp": "2026-06-28T10:15:00Z",
  "source": "silent-capture",
  "state": "pending",
  "entry": {
    "id": "runbook-browserstack",
    "title": "Browserstack Setup",
    "content": "...",
    "tags": ["mobile", "test-automation"],
    "classification": "runbook"
  },
  "metadata": {
    "captureContext": "working on mobile feature",
    "confidence": 0.92
  }
}
```

### 5.5 Operation Lifecycle

Operations progress through states:
1. `pending` — newly created
2. `frozen` — included in publish batch (immutable)
3. `applied` — replayed into files
4. `committed-local` — committed to context branch
5. `pushed-remote` — pushed to remote
6. `merged` — merged via PR
7. `failed` — needs intervention
8. `discarded` — explicitly removed

---

## Publish Workflow

### 6.1 Publish Principle

Publish is **deliberate and explicit**, transforming pending corpus into published corpus.

**Invariants:**
- Explicit (not automatic except with opt-in config)
- Resumable (can restart mid-publish safely)
- Deterministic (same ops + same base = same output)
- Reviewable (dry-run shows exactly what will change)
- Safe (atomic local boundary, recoverable remote steps)

### 6.2 Publish Stages

#### Stage 0: Preflight

- Resolve configured context branch
- Record current work branch
- Validate pending manifest integrity
- Check for branch safety
- Check for lock conflicts
- Verify pending base commit matches
- Compute diff between base and current context branch HEAD

**Failure:** Abort, preserve pending state, restore work branch if switched.

#### Stage 1: Freeze

- Freeze current pending operations into a publish batch
- Assign batch ID
- Mark all operations as "frozen" (immutable)
- Create batch metadata file

**Purpose:** Snapshot what we're about to publish.

#### Stage 2: Create Sparse Worktree

Rather than checking out the full repository (potentially GBs), use `git sparse-checkout` to checkout only `.claude/` directories:

```bash
git worktree add --no-checkout /tmp/contextus-publish-<batch-id> contextus/main

cd /tmp/contextus-publish-<batch-id>

# Configure sparse checkout
git sparse-checkout init --cone
git sparse-checkout set .claude/

# Now checkout (only .claude/ files pulled)
git checkout
```

**Benefits:**
- Minimal disk footprint (KBs–MBs vs. full repo)
- Fast checkout and network fetch
- Prevents accidental edits to non-corpus files
- Scales cleanly to large repositories

#### Stage 3: Apply

- Sync local `.claude/context/` → temp-worktree `.claude/context/`
- Validate scope and structure of generated changes
- Ensure only allowed corpus paths changed

**Determinism:** Same ops + same base state → same output.

#### Stage 4: Validate

- Ensure only `.claude/context/**` and `.claude/contextus/**` changed
- Detect unresolved conflicts
- Confirm operation replay success
- Validate file structure (well-formed JSON, valid schema)

#### Stage 5: Commit

- Create single commit for publish batch
- Record batch metadata in commit message
- Append audit record to publish history
- Mark operations as "committed-local"

**Commit message format:**
```
[contextus] publish batch <batch-id> (<op-count> operations)

Operations:
  - add-entry (3)
  - update-entry (2)
  - archive-entry (1)

Batch ID: <batch-id>
Base Commit: <base-commit-sha>
```

#### Stage 6: Share

- Push commit to remote (or skip if local-only)
- Open/update PR (if PR topology)
- Leave behavior to team configuration

**Not atomic:** If push/PR fails, batch is still locally committed. Can retry independently.

#### Stage 7: Cleanup & Restore

- Remove sparse worktree: `git worktree remove /tmp/contextus-publish-<batch-id>`
- Return to saved work branch
- Clear frozen pending operations
- Verify successful restoration
- Surface summary of what was published

**Safety rule:** Never leave user on context branch unless explicitly requested (`--stay-on-context`).

### 6.3 Transaction Boundary

**Strict atomic transaction:** Local application and commit (Stages 0–5)

**Recoverable follow-up:** Remote push and PR creation (Stage 6)

If push/PR fails after local commit, batch is marked "locally-committed" and can be retried.

---

## Git Implementation Details

### Sparse Worktree Strategy

**Why sparse checkout is optimal:**
- Only `.claude/` directories are needed for corpus publication
- Eliminates disk and network overhead of checking out full repo
- Prevents accidental edits to source code
- Scales cleanly to multi-GB repositories

**Implementation:**
```bash
# Create worktree on context branch without checking out anything
git worktree add --no-checkout $WORKTREE_PATH $CONTEXT_BRANCH

cd $WORKTREE_PATH

# Configure sparse checkout to only get .claude/
git sparse-checkout init --cone
git sparse-checkout set .claude/

# Now do the actual checkout (only .claude/ files pulled)
git checkout

# Verify we have what we need
[ -d .claude/context ] || fail "sparse checkout failed"
```

**Edge cases handled:**
1. **Context branch has .gitignore** — Sparse checkout respects .gitignore. Ensure context branch does NOT ignore `.claude/` (only code branches do)
2. **Generated files in .claude/contextus/** — Sparse checkout includes them (they're under `.claude/`)
3. **Concurrent publishes** — Each worktree is independently locked by Git; no conflicts
4. **Performance** — First-time sparse checkout slightly slower than direct checkout; subsequent operations are faster; net win for large repos

### Branch Protection and CI

Teams should protect context branch with:
- PR review requirement before merge
- Required CI checks (corpus validation, scope checking)
- Optional CODEOWNERS rules
- Restricted direct pushes (PRs only, no force-push)

**CI should reject** corpus changes on non-context branches:
```python
if pr.target_branch != config['contextBranch']:
    corpus_files = [f for f in pr.diff if f.startswith('.claude/')]
    if corpus_files:
        pr.fail("Corpus changes only allowed on context branch")
```

---

## Local Materialization Strategy

### The Challenge

During development, users need to:
- Browse the corpus locally
- Edit/refine entries before publishing
- Retrieve relevant context (fast local lookups)

But pending operations are stored as JSON metadata. This raises questions:
- Should `.claude/context/` be a working copy on code branches (gitignored)?
- Or should it only exist during publish (on temp worktree)?

### The Solution: Dual Materialization

**Local development phase:**
- Silent capture writes **both**:
  - Pending operation (metadata/audit trail)
  - Materialized entry in `.claude/context/` (for local browsing/editing)
- `.claude/context/` is gitignored on all code branches (never committed)
- Retrieval queries local `.claude/context/` directly (fast, fresh)
- Users can browse and refine entries locally before publishing

**Publish phase:**
1. **Preflight:** Validate local `.claude/context/` is consistent with pending ops (or warn)
2. **Create sparse worktree:** Check out only `.claude/` from context branch
3. **Sync corpus:** Copy local `.claude/context/` → temp-worktree (sync current state)
4. **Validate & commit:** Commit synced corpus to context branch
5. **Cleanup:** Remove worktree, clear published pending ops

**On pull / context branch update:**
- `.claude/context/` is fetched from context branch
- Materializes locally (updates local working copy)
- Pending ops for published batches are cleared

### .gitignore Requirements

**All code branches** must have:
```
.claude/context/          # Local working copy; never committed to code branches
.claude/contextus/pending # Pending state is local only
```

**Context branch(es)** must NOT have this rule (corpus is committed there).

---

## Conflict Resolution

### Conflict Categories

- **File conflicts** — same file modified by both pending and published
- **Semantic conflicts** — same entry changed by both sides
- **Policy conflicts** — pending change violates team rules
- **Staleness conflicts** — base commit has drifted; pending ops replay differently

### Conflict Detection Algorithm

#### Phase 1: Base Commit Drift Detection

```
baseContextCommit = manifest.baseContextCommit
currentContextBranchHEAD = git rev-parse contextus/main

if baseContextCommit == currentContextBranchHEAD:
    return NO_DRIFT
else:
    driftCommits = git log baseContextCommit..currentContextBranchHEAD
    corpusFiles = [f for f in driftFiles if f.startswith('.claude/')]
    
    if corpusFiles is EMPTY:
        return DRIFT_SAFE  # Drift exists but not in corpus paths
    else:
        return DRIFT_WITH_CORPUS_CHANGES  # Proceed to Phase 2
```

**Handling drift:**
- If `DRIFT_SAFE`: Proceed normally; pending ops replay against new HEAD
- If `DRIFT_WITH_CORPUS_CHANGES`: Compute conflict set; require review for entries touched by both sides

#### Phase 2: Semantic Conflict Detection

For each pending operation, check if the target entity was modified upstream since `baseContextCommit`.

**For add-entry operations:**
- Check if entity already exists upstream at current HEAD
- If exists: `add-add` conflict (added both locally and upstream)
- If not: Safe to add

**For update-entry operations:**
- Compare base version → upstream version → pending version
- If only one side changed: Safe (apply the change)
- If both sides changed: `update-update` conflict (manual review required)

**For remove/archive-entry operations:**
- Check if entity was modified upstream after removal was staged
- If modified upstream: `remove-update` conflict (requires review)
- If unchanged: Safe to remove

**For supersede-entry operations:**
- Check if either side of supersession changed upstream
- If either changed: `supersede-update` conflict
- If unchanged: Safe to supersede

### Conflict Records

Conflicts are persisted in `.claude/contextus/pending/conflicts/` for systematic review:

```json
{
  "conflictId": "conflict-entry-xyz-20260628-a1b2c3",
  "opId": "op-042",
  "conflictType": "update-update",
  "severity": "high",
  "details": {
    "entityId": "entry-runbook-xyz",
    "baseVersion": {...},
    "upstreamVersion": {...},
    "pendingVersion": {...},
    "divergentFields": ["tags", "description"]
  },
  "suggestedResolution": "manual-review",
  "status": "pending-resolution"
}
```

**Workflow:**
1. Conflict detected during preflight/validation
2. Conflict record created and persisted
3. Publish pauses; user is informed
4. User reviews via `contextus conflicts` command
5. User chooses resolution per conflict
6. User runs `contextus publish --continue`
7. Publish resumes with resolutions applied

### Resolution Options

- **accept-upstream** — Discard pending op; use upstream
- **accept-local** — Keep pending op; overwrite upstream
- **accept-local-if-newer** — Keep pending if timestamp is newer than upstream (default)
- **merge-manually** — Human combines fields from both sides
- **recompute-from-current-head** — Re-run capture against new HEAD
- **discard-pending-op** — Abandon pending operation entirely
- **defer-op** — Don't publish now; keep pending for next publish

### Default Resolution Strategy

**Config:** `conflictDefaultResolution: "accept-local-if-newer"`

Most users will `accept-local` everything. Rather than forcing interactive review for every conflict, the default strategy auto-resolves when the pending operation is newer than the upstream change by timestamp. This handles the common case (developer captures something today, upstream change was 3 days ago) without requiring manual intervention.

**Interactive review is forced for:**
- Destructive operations (archive, remove, supersede) — always require explicit approval
- Conflicts where upstream is newer than pending — likely means someone else made a deliberate change
- Policy conflicts — team rules take precedence

**Override:** Set `conflictDefaultResolution: "manual"` to require interactive review for all conflicts.

---

## Failure Recovery & Rollback

### Failure Classes

- **Preflight** — Git state invalid, lock conflict, base commit mismatch
- **Branch switch** — Git checkout fails
- **Apply** — Operation replay fails, file structure invalid
- **Validation** — Conflicts detected, policy violation
- **Commit** — Git commit fails
- **Push** — Network error, rejected by remote
- **PR creation** — API error, branch already has PR
- **Branch restoration** — Couldn't restore original branch

### Recovery Rules

**If failure occurs before local commit (Stages 0–4):**
- Keep pending operations intact
- Record the failure (timestamp, stage, error message)
- Restore work branch if switched (safely)
- Do not mark operations as published
- **User action:** Fix the issue, run `contextus publish` again

**If failure occurs after local commit but before push (Stage 5 complete, Stage 6 fails):**
- Mark batch as "locally-committed"
- Update manifest to record partial success
- Do not alter pending operations (they're published, just not shared yet)
- **User action:** Run `contextus publish --continue` to retry push/PR

**If failure occurs after push but before PR creation:**
- Mark batch as "remotely-published"
- Allow PR creation retry independently
- **User action:** Run `contextus publish --continue` to retry PR

### Rollback Model

Rollback is **explicit and stateful**, not implicit.

A rollback may:
- Revert the publish commit (via `git revert` or force-push per team policy)
- Mark batch as "failed" or "reverted"
- Preserve original pending records until user confirms discard or requeue

---

## CLI & UX

### Required Commands

```bash
contextus pending              # Show pending operations
contextus pending --json       # JSON output for scripting
contextus publish              # Publish pending to context branch
contextus publish --dry-run    # Preview without applying
contextus discard <opId>       # Discard specific operation
contextus conflicts            # Show unresolved conflicts
contextus reconcile            # Detect/repair pending state corruption
contextus sync                 # Pull context branch, then publish
```

### Command Outputs

#### `contextus pending`

```
Contextus: 6 pending operations
  • 3 add-entry
  • 2 update-entry
  • 1 archive-entry

Base context commit: abc123... (2 hours ago)
Status: ready to publish
Publish mode: pr (would open PR after commit)

Run `contextus publish --dry-run` to preview changes.
```

#### `contextus publish --dry-run`

```
Contextus: Dry-run publish

Batch: batch-2026-06-28-001
Operations:
  • add-entry: runbook-browserstack-setup
  • update-entry: test-flake-debugging (tags)
  • archive-entry: obsolete-appium-notes

Files changed:
  .claude/context/entries/runbook-browserstack-setup.md (+42)
  .claude/context/entries/test-flake-debugging.md (+8, -2)
  .claude/contextus/archive.json (+1)

Target: contextus/main
Topology: pr (will open/update PR)

Conflicts: none
Validation: ✓ pass

Run `contextus publish` to proceed.
```

### Reminders

If pending changes exist:

```
⚠️ Contextus: pending corpus changes exist locally and are not yet published.
   Run `contextus pending` or `contextus publish --dry-run` to review.
   Run `contextus publish` to publish to the context branch.
```

Show in:
- IDE footer/status bar
- Shell prompt (if integrated)
- Session-end prompt (if `publishAtSessionEnd: true`)

---

## Team Git Gating

### Principle

Git should gate **shared corpus publication**, not local pending state.

**Corollary:** Pending state is machine-local and durable. Shared corpus authority comes only from the context branch.

### Publication Topologies

#### `direct-commit` (not recommended)
- Commits directly to context branch
- No PR, no review, no audit trail
- Fast but loses visibility
- **Only for: very small teams with extreme trust**

#### `pr` (recommended for all teams)
- Publishes to temporary branch (`contextus/publish-<batch-id>`)
- Opens PR against context branch
- Requires approval, CI passing
- Provides full audit trail

**Flow with PR topology:**
```
developer on feature/*
  ↓
contextus publish [--dry-run first]
  ↓
creates contextus/publish-<batch-id>
  ↓
pushes to remote
  ↓
opens PR → contextus/main
  ↓
CI runs corpus validation
  ↓
[team reviews and approves]
  ↓
merges PR
  ↓
deletes contextus/publish-<batch-id>
  ↓
restores work branch
```

#### `bot-mediated` (reserved for Phase 3+)
- Bot creates PR on behalf of user
- Allows better attribution while preserving review
- Requires authenticated bot account and CI integration

---

## Feature Integration

### Silent Capture

**V2 behavior:** Emits pending operations during normal work rather than directly mutating published corpus.

- On code branches: capture → pending state (no commit)
- Materializes locally to `.claude/context/` (gitignored)
- Reminder: "X pending captures exist; run `contextus publish` to review"

### Mining

**Sources:** Transcripts, PRs, diffs, external docs

**V2 behavior:** Mining normalizes findings into pending operations.

- Subject to publish workflow and team review
- Dedup strategy: watermark, corpus similarity (0.82+), source-field dedup, cross-source dedup

### CAE (Context Applicability Evaluator)

**Phase 2 (current):** Read-only evaluation on all branches.

**Phase 3 (future):** Proposes removals, supersessions, archives.

**V2 design:**
- Read-only layer works on all branches (no mutations)
- Write-intent layer emits pending operations (proposed changes)
- All CAE-proposed changes subject to publish workflow and team review
- Never directly mutate published corpus from code branches

### Usage Evaluation

Usage ratings and metadata may be:
- Captured during normal work
- Staged as pending metadata
- Published through workflow (to context branch)
- Used by retrieval to rank results

### Retrieval

**Default:** Retrieval includes both published corpus AND pending entries (`retrieveWithPendingOverlay: true`).

This ensures newly captured patterns are immediately useful — the core promise of "capture now, retrieve immediately" is preserved regardless of publish state.

**Dedup strategy:** If a pending entry and a published entry share the same entity ID, the published version is used (it's the authoritative copy). Pending-only entries are included with a `[pending]` provenance marker.

**Opt-out:** Set `retrieveWithPendingOverlay: false` if you want retrieval to only use the published (shared, team-reviewed) corpus. Useful for strict team environments where unreviewed content shouldn't influence responses.

---

## Migration from V1 (Solo → Team Mode)

### The .gitignore Problem

**Current state (V1):** `.claude/context/` is committed on code branches. This is how context persists between clones, machines, and developers. It works for solo users.

**Team mode proposes:** `.claude/context/` gitignored on code branches, only committed on the context branch.

**Breaking change:** A fresh clone on a code branch would have no context until pulling from the context branch. This adds onboarding friction that V1 doesn't have.

### Solution: Graduated Migration

The migration from solo → team is explicit and non-breaking:

1. **Solo mode (V1, default):** `.claude/context/` stays committed on code branches. No change from current behavior. This is the state all new users and pilots start in.

2. **Team mode activation:** When a team opts in (`publishMode: "manual"`):
   - First publish seeds the context branch from existing `.claude/context/`
   - `.claude/context/` is added to `.gitignore` on code branches
   - A `contextus pull` step is added to fresh-clone setup (or automated by session-start hook)
   - Existing corpus becomes the initial published state

3. **Fresh clone flow (team mode):**
   ```bash
   git clone <repo>
   # Session-start hook detects team mode + empty .claude/context/
   # Automatically: git checkout contextus/main -- .claude/context/
   # Or: contextus pull (explicit)
   ```

**Key guarantee:** No existing user's workflow breaks. Solo mode is default. Team mode is opt-in and includes migration tooling.

---

## Implementation Roadmap

Recommended build order. **Gate criterion:** each phase should only begin when real usage validates the need for the next.

### Phase 0: Solo Mode Preservation (no work needed)
- Current V1 behavior IS solo mode
- `publishMode: "none"` becomes the explicit default in config schema
- No code changes required — just documenting the contract

### Phase 1: Foundation (V2 Core) — Gate: 2+ pilot teams request publish workflow
1. Pending operation schema and validators
2. Manifest and op-log storage layer
3. `contextus pending` command
4. `contextus publish --dry-run` preview
5. Local publish with branch restore (Stages 0–7 without remote)
6. Local materialization (.claude/context/ gitignored on code branches)
7. Solo → team migration tooling (seed context branch from existing corpus)

### Phase 2: Remote Publish — Gate: Phase 1 validated by pilot teams
8. Push and PR automation (Stage 6 full)
9. Sparse worktree for efficient publish
10. Publish branches and PR gating

### Phase 3: Safety & Conflicts — Gate: merge conflicts actually observed
11. Conflict detection (base drift + semantic conflicts)
12. Conflict records and review workflow
13. Failure recovery and rollback stubs
14. `contextus reconcile` for state repair

### Phase 4: Team Features — Gate: 3+ teams actively publishing
15. CI enforcement rules
16. Configuration system (global + project-level overrides)
17. IDE visibility and session-end prompts
18. Mining integration (with dedup)

### Phase 5: Advanced Features
19. Pending overlay retrieval optimization
20. CAE Phase 3 integration (write-intent → pending ops)
21. Usage metadata publishing
22. Operation log compaction

### Phase 6: Polish
23. Comprehensive error messages
24. Audit logging and history
25. Documentation and examples
26. Bot-mediated publish topology

---

## Open Questions

### Configuration & Behavior

**Q1: Publish mode triggers**
- What exactly triggers "session-end" publish? IDE close event? Shell exit? Inactivity timeout?
- Can a single user have different publish modes per project?
- Should scheduled mode run on cron/timer, and if so, what's the frequency?

**Q2: Archive branch purpose**
- Why is `archiveBranch` separate from `contextBranch`?
- When do we publish to archive vs. main context branch?
- How does `archive-entry` operation interact with archiveBranch?

**Q3: Pending state persistence across machines**
- Pending state lives locally. If a developer switches machines, are pending operations lost?
- Should pending state be stored somewhere durable (S3, Git, etc.)?
- What's the backup strategy?

### Pending Corpus & Operations

**Q4: Operation deduplication**
- If silent capture fires twice on same code snippet, do we get two `add-entry` operations or one?
- How do we detect duplicate captures?

**Q5: Mining and dedup interaction**
- Mining uses a five-layer dedup strategy (watermark, corpus similarity, source-field, cross-source, within-batch)
- Where does this dedup live in publish workflow? Before generating pending ops? During aggregation?
- What if mining detects entry already exists but conflicts with pending op?

**Q6: Base commit staleness**
- If `baseContextCommit` drifts (user on feature branch for 3 days, context branch advances), what happens?
- Do we detect drift in preflight? Fail, or automatically rebase pending ops?
- What if rebase is impossible (conflicting changes)?

### Conflict Resolution

**Q7: Entity identity**
- How do we compute "entity identity" for conflict detection?
- Is it a semantic hash? User-assigned ID? Both?

**Q8: CAE conflict semantics**
- If CAE marks entry for removal but upstream modified it, what happens?
- Do we require manual review, or special policy for CAE-driven conflicts?

**Q9: Conflict resolution UX**
- When conflicts require manual review, how do users resolve them?
- CLI prompt? Text editor? Deferred batch?
- What if user closes conflict without resolving?

### Publish Workflow & Safety

**Q10: Branch switching reliability**
- Publish requires recording work branch, switching to context, restoring.
- What if Git is in weird state (detached HEAD, no tracking)?
- Should we fail preflight if we can't reliably detect current branch?

**Q11: Dry-run correctness**
- Does `--dry-run` actually apply ops to temp branch and compute real diffs?
- Or does it simulate/predict without touching filesystem?
- Former is more reliable; latter is faster.

**Q12: Concurrent publish attempts**
- What if two sessions try to publish simultaneously?
- Lock semantics: file-based? How do we handle stale locks?

**Q13: Sparse worktree edge cases**
- What if .gitignore on context branch has rules that affect .claude/?
- Should we validate that context branch doesn't ignore .claude/?

### Feature Integration

**Q14: Silent capture on non-context branches** ✅ RESOLVED
- **Answer: (A) — Silently create pending op + materialize locally.**
- Developer stays on their code branch at all times.
- Pending op is created (for audit/publish trail).
- Entry is also materialized to `.claude/context/` (gitignored) for immediate local retrieval.
- No branch switching, no permission prompt, no disruption.
- In solo mode: capture writes directly to `.claude/context/` (no pending op created).

**Q15: Pending overlay retrieval**
- When is pending-overlay retrieval useful? Local session awareness of incomplete work?
- Doesn't this defeat dedup (pending + published might contain duplicates)?
- Should retrieval CAE see pending entries as "live" or "draft"?

### Infrastructure & Scaling

**Q16: Operation log compaction**
- If user is very active (hundreds pending ops/week), does ops/ folder become unwieldy?
- Should we compact log periodically (e.g., every 100 ops)?
- How do we maintain determinism and auditability?

**Q17: Context branch history**
- Over time, context branch will have many small semantic-only commits.
- Is context branch history stable (append-only, never rebase)?
- Can teams squash/rebase context PRs before merge?

---

## Safety Rules

### Contextus Must Not

- **Silently discard pending corpus** — preserve until explicit user discard or successful publish
- **Publish corpus changes to code branches** — corpus changes only on context branch during normal work
- **Auto-resolve destructive conflicts** — require human review for removals, supersessions, major changes
- **Strand user on context branch** — always restore work branch unless explicitly requested

### Contextus Should

- **Preserve the work branch** — always save and restore original branch during publish
- **Keep audit history** — log all operations, publishes, conflicts, rollbacks
- **Fail visibly rather than silently** — clear error messages
- **Support replay and recovery** — all operations are resumable and replayable
- **Provide clear visibility** — CLI commands, IDE integration, reminders
- **Enable team governance** — Git as quality gate, PR review, CI validation

---

## Summary

This specification defines a **safe, Git-native workflow** for semantic corpus evolution in Contextus V2.

**Core benefits:**
- ✅ Eliminates Git noise from semantic evolution
- ✅ Isolates corpus churn from feature branches
- ✅ Protects PRs from irrelevant context diffs
- ✅ Avoids disrupting active coding sessions
- ✅ Makes CAE and mining safe to run aggressively
- ✅ Keeps corpus evolution deliberate and reviewable
- ✅ Preserves Git as quality gate for shared corpus
- ✅ Scales cleanly to teams
- ✅ Supports recovery and rollback

**Central idea:**

> **Capture during work, publish deliberately, and never let corpus churn disrupt the developer's code branch.**

The three-stage model (ephemeral → pending → published) provides clear architectural boundaries. The publish workflow is deterministic, resumable, and safe. Sparse worktrees minimize overhead. Local materialization enables browsing. Conflict resolution is explicit and team-friendly. Git gating happens at the right layer (shared corpus, not local pending).

Ready for Phase 1 implementation.

---

## Appendices

### Appendix A: Pending Operation Schema (JSON)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Pending Operation",
  "type": "object",
  "required": ["opId", "type", "timestamp", "source", "state"],
  "properties": {
    "opId": {
      "type": "string",
      "pattern": "^op-[0-9]+-[a-z-]+$"
    },
    "type": {
      "type": "string",
      "enum": [
        "add-entry",
        "update-entry",
        "remove-entry",
        "archive-entry",
        "supersede-entry",
        "retag-entry",
        "reclassify-entry",
        "update-usage-metadata",
        "generate-semantic-doc",
        "delete-semantic-doc"
      ]
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "source": {
      "type": "string",
      "enum": ["silent-capture", "mining", "cae", "user-manual", "auto-doc"]
    },
    "state": {
      "type": "string",
      "enum": [
        "pending",
        "frozen",
        "applied",
        "committed-local",
        "pushed-remote",
        "merged",
        "failed",
        "discarded"
      ]
    },
    "entry": {
      "type": "object",
      "properties": {
        "id": { "type": "string" },
        "title": { "type": "string" },
        "content": { "type": "string" },
        "classification": {
          "type": "string",
          "enum": [
            "runbook",
            "pattern",
            "architecture",
            "decision",
            "debug-note",
            "other"
          ]
        },
        "tags": { "type": "array", "items": { "type": "string" } },
        "createdAt": { "type": "string", "format": "date-time" },
        "updatedAt": { "type": "string", "format": "date-time" }
      },
      "required": ["id", "title", "content"]
    },
    "metadata": {
      "type": "object",
      "properties": {
        "captureContext": { "type": "string" },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
        "lineage": { "type": "string" },
        "authorEmail": { "type": "string" }
      }
    }
  }
}
```

### Appendix B: Manifest Schema (JSON)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Pending Corpus Manifest",
  "type": "object",
  "required": [
    "projectId",
    "contextBranch",
    "sessionId",
    "baseContextCommit",
    "lastUpdatedAt"
  ],
  "properties": {
    "projectId": { "type": "string" },
    "contextBranch": { "type": "string" },
    "sessionId": { "type": "string", "format": "uuid" },
    "baseContextCommit": { "type": "string" },
    "workBranchAtLastMutation": { "type": "string" },
    "pendingOperationCount": { "type": "integer", "minimum": 0 },
    "publishState": {
      "type": "string",
      "enum": ["idle", "capturing", "frozen", "applying", "validating", "committed", "failed"]
    },
    "lastUpdatedAt": { "type": "string", "format": "date-time" }
  }
}
```

### Appendix C: Configuration Schema (JSON)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Contextus Configuration",
  "type": "object",
  "properties": {
    "contextus": {
      "type": "object",
      "properties": {
        "contextBranch": {
          "type": "string",
          "default": "contextus/main"
        },
        "archiveBranch": {
          "type": "string",
          "default": "contextus/archive"
        },
        "publishMode": {
          "type": "string",
          "enum": ["manual", "session-end", "scheduled"],
          "default": "manual"
        },
        "publishTopology": {
          "type": "string",
          "enum": ["direct-commit", "pr", "bot-mediated"],
          "default": "pr"
        },
        "publishAtSessionEnd": {
          "type": "boolean",
          "default": false
        },
        "remindOnPendingCorpus": {
          "type": "boolean",
          "default": true
        },
        "retrieveWithPendingOverlay": {
          "type": "boolean",
          "default": false
        },
        "requireDryRunBeforePublish": {
          "type": "boolean",
          "default": false
        },
        "sessionIdleThresholdMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 1440,
          "default": 30
        }
      }
    }
  }
}
```

---

## Implementation Checklist (Phase 1)

- [ ] Pending operation schema finalized and validated
- [ ] Manifest and storage layout implemented
- [ ] `contextus pending` command working
- [ ] `contextus publish --dry-run` preview accurate
- [ ] Local publish workflow (Stages 0–7) without remote
- [ ] Sparse worktree implementation for efficient corpus operations
- [ ] Local materialization (.claude/context/ gitignored)
- [ ] Configuration system (global + project-level)
- [ ] Error handling and failure recovery
- [ ] Comprehensive test suite

---

**Version:** 1.0 (unified draft incorporating Q1, Q2, and V2 spec)  
**Last Updated:** 2026-06-28  
**Status:** Ready for implementation review  
**Audience:** Contextus core team, stakeholders
