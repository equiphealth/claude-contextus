---
name: context-index-cant-be-partially-staged
description: >-
  CONTEXT.md is one shared incrementally-upserted file, so selectively
  git-adding some captured context files but not others leaves it referencing
  uncommitted files
metadata:
  type: tradeoff
  tags:
    - capture
    - git-workflow
    - index
---

## Problem

Staging-mode capture (the default, `contextCapture.mode: staging`) relies on git as the quality gate: Claude writes context files directly, they show up as untracked/modified in `git status`, and the user decides what to `git add` at commit time (`dev/SILENT_CAPTURE_V2.md`, `long-running-turn-capture.md`).

This model quietly breaks down for the **index file**. `lib/capture/context-index.ts`'s `upsertIndexEntry` does an incremental, in-place text upsert directly on `.claude/context/CONTEXT.md`, keyed by each entry's relPath link — every `/capture` call during a session edits the SAME file, appending or updating one line. If a session captures 5 context files and the user only wants to keep 3 (the other 2 being rejected false positives, duplicates, or just not worth keeping), there's no clean way to stage "only 3 of the 5 lines" in `CONTEXT.md`:

- `git add <path>` operates on whole files — can't cherry-pick lines within one file via normal staging.
- `git add -p` (patch/hunk-level partial staging) technically CAN split a file into hunks, but it's an interactive, error-prone UX for a non-git-expert to get right on a list-style index file, and it's not available to me as the agent at all — this harness explicitly disallows interactive git flags (`-i`) since they require interactive input the tool layer doesn't support (see CLAUDE.md git safety protocol).
- Committing `CONTEXT.md` as-is (with all 5 lines) while only adding 3 of the actual pattern files leaves the index referencing 2 files that don't exist for anyone without the user's local untracked copies — broken for CI, another clone, or the same user after `git clean`.

**Secondary doc inaccuracy surfaced by this**: the docs describe rejecting a false-positive capture as costing "just a `git checkout`" (`long-running-turn-capture.md`, `FEATURES.md`). That's incorrect for a brand-new file that was never committed — `git checkout <path>` is a no-op on an untracked file. The actual undo is `rm <path>` (plus now also un-doing its `CONTEXT.md` line, which is the gap this note is about).

## Direction: CONTEXT.md should be regenerated, not incrementally upserted, at commit time

`lib/capture/memory-migrate.ts`'s `renderContextIndex(items)` (line ~217) already does exactly the right thing in a different context: given a list of `{slug, type, description, relPath}`, it renders a full `CONTEXT.md` from scratch, grouped by category, sorted, with an "Other" bucket so nothing's silently dropped. It's written for the one-time memory-to-context migration, but the rendering logic itself has no migration-specific dependency — generalizing its input type and feeding it a live directory scan (read frontmatter from whatever `.claude/context/**/*.md` files are being kept) gives a reusable "rebuild the index from this exact file set" primitive.

That primitive is the fix: a commit-time skill/workflow that (1) shows the user what's new/modified under `.claude/context/` (`git status --short`), (2) lets them pick which files to keep vs. discard, (3) `rm`s anything discarded (since `git checkout` won't), (4) regenerates `CONTEXT.md` via the generalized `renderContextIndex` from exactly the files that will remain, and (5) stages the regenerated index alongside the kept pattern files. This turns `CONTEXT.md` into a derived artifact (matching the LanceDB table's "derived index" treatment — see `decisions/decision-lancedb-schema-migrations-via-full-rebuild.md`) instead of a stateful file that accumulates whatever order captures happened to land in.

## Why this matters

Without this, the staging-mode "git is the quality gate" model has a hole: it works fine for the pattern files themselves (plain add/reject per file) but silently breaks for the index the moment a session captures more than the user wants to keep in one go — which, per this project's own capture philosophy ("bias toward capturing"), is expected to happen regularly, not as an edge case.

