---
name: capture-metadata-commit-hash-and-file-path
description: >-
  Capture sourceFile + content hash for drift detection, plus branch name for
  human traceability, on context captures
metadata:
  type: tradeoff
  tags:
    - capture
    - metadata
    - schema
    - staleness
---

## Idea (revised)

Augment the frontmatter/metadata written by `POST /capture` with:

1. **`sourceFile`** (or `triggerPath`) — the file path that triggered the capture, when correlated with a PostToolUse Read/Write/Edit hook (e.g. via `/notify`). Optional: ad hoc/conversation-driven captures have no single triggering file.
2. **`sourceContentHash`** — a content hash (e.g. sha256) of `sourceFile` taken *at capture time*. This, not a git commit hash, is the actual drift-detection mechanism: at audit time, re-hash the current file and compare. Mismatch = "the file this note describes has changed since capture" — true regardless of git history, branches, commits, or whether the file was ever committed at all.

`commitHash` (the original idea) is **demoted to optional/cosmetic** — fine to record for human context ("written around commit X") but not relied upon for drift detection. See below for why.

3. **`branchName`** — the current branch name at capture time (`git branch --show-current`), also optional/cosmetic, purely for human traceability. Many teams (including this user's work repo) encode a ticket number in branch names (e.g. `fix/PATH-1234-description`) — recording it gives a free "why was this written" breadcrumb even after the branch is deleted, without needing the branch or its commits to still exist. Cheaper and more durable than `commitHash` for that purpose since it's just a string, not something that needs to resolve against git history later.

## Why content hash beats commit hash

- **No git dependency**: works even if the file was never committed, the branch was deleted, history was rebased, or the capture happened in a sandbox with no reflog.
- **Durable forever**: a content hash doesn't expire or get GC'd the way an unreachable commit becomes a dangling object. It's just two hashes compared, always resolvable.
- **Directly answers the question that matters**: "did the described file change?" — not "can I still resolve a historical git ref," which is a proxy that can fail even when the real answer is knowable.
- **Simpler to implement**: no git shell-out, no ref-resolution edge cases, no fallback-on-unreachable-hash logic. Just `hash(file contents)` at capture and at audit time.

## Why this matters

- **Drift detection**: `context-audit`/`context-calibrate` currently judge staleness by modified-time and retrieval/usage stats only. A `sourceContentHash` mismatch is a precise, binary "this file changed" signal — sharper than mtime (which changes on touch/reformat without content change) and more durable than a git-hash diff.
- **Path-scoped retrieval/audit**: `sourceFile` enables queries like "show me all context tied to `daemon/server.ts`" and lets an audit step flag context whose source file's content hash no longer matches.
- Complements the existing corpus self-maintenance via `/delete` pattern (session-driven archival) with a mechanical, git-independent signal.

## Tradeoffs / open questions

- `sourceFile` is only available when capture correlates with a PostToolUse hook invocation — ad hoc conversational captures (like this one) have no single "source file," so both fields must stay optional.
- A content-hash mismatch tells you the file changed, but not *how much* or whether the specific thing the note described actually moved (e.g. a comment tweak vs. a logic rewrite) — same coarseness problem a diff would have, just without needing git to compute it.
- Needs schema/frontmatter changes in `POST /capture` and downstream consumers (`context-audit`, `context-stats`, retrieval scoring) to actually use the new fields — capturing metadata nothing reads is dead weight.
- Worth checking whether this should land as a V2 roadmap item before implementing, since it touches the capture schema that multiple skills depend on.
- Related open question: how much weight *created date* alone should carry in staleness/audit scoring, separate from content-hash-based drift detection.

## Why commitHash was dropped as the primary mechanism

Captures very likely happen on a feature branch, not `main`. Once that branch is deleted (normal post-merge cleanup, especially with squash-merge which rewrites the commit entirely), the recorded hash may no longer exist in any ref. The same staleness applies more subtly to rebases/force-pushes even on a surviving branch — the hash stays reachable but no longer represents "current state of that branch."

Git doesn't delete commit objects the instant a branch ref is removed — they become "dangling" objects, recoverable locally via `git reflog` (default ~90 days, `gc.reflogExpire`) or `git fsck --lost-found`, until `git gc` eventually collects them (default grace ~2 weeks once GC runs, `gc.pruneExpire`). But reflog is **local-only** (never pushed/shared) — a capture made in one sandbox/CI run and audited later from a different clone has no reflog to fall back on regardless of timing.

Net: commit-hash-based drift detection is recoverable only in a narrow, local, time-boxed window — not durable enough to design the feature around. Content hashing sidesteps the whole problem.

## Tracking

Filed as [GitHub issue #95](https://github.com/equiphealth/claude-contextus/issues/95), updated to reflect this revision plus `branchName`.

