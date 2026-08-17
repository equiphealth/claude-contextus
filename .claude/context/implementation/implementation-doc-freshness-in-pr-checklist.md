---
name: doc-freshness-in-pr-checklist
description: README.md and docs/FEATURES.md drifted for months with no CI check; doc freshness is now a PR checklist item, not an automated gate
metadata:
  type: implementation
  tags: ["docs", "pr-workflow", "readme", "features"]
---

# What happened

A 2026-08-17 audit of `README.md` and `docs/FEATURES.md` against `git log` found they had drifted significantly behind shipped features:

- **4 skills missing from both skill lists**: `context-archive`, `context-merge`, `context-stats`, `mine-transcripts` (shipped across several PRs, never added to either doc)
- **2 daemon endpoints undocumented**: `POST /capture` (the entire staging-mode capture path) and `POST /delete` (archive endpoint, PR #34)
- **Wrong `metadata.type` enum** in FEATURES.md's frontmatter example — listed `feedback`/`question` as valid types, which `skills/create-context/reference.md` explicitly says are NOT valid (the real enum is `arch, decision, tradeoff, gotcha, api, phase, project, schema, security, perf, reference, implementation`)
- **Stale skill counts** — both docs said "26 skills"; actual count was 24
- **Stale version footer** — README said "Status: v0.9.0" while `package.json` was at 0.19.1 (10 releases behind)
- **README still described only the old `propose` capture flow**, even though `staging` has been the shipped default mode since PR #11/#12

## Why it happened

Nothing in CI or the PR process checks these docs. `pnpm test`/`tsc --noEmit`/prettier all pass regardless of whether README.md or FEATURES.md mention a new skill or endpoint. The existing PR checklist (see [[release-process]]) only covered version bump + CHANGELOG — both of which ARE enforced (release.yml reads package.json version). Docs without an enforcement mechanism drift; docs with one (CHANGELOG, via the release workflow) don't.

## Fix

Added doc-freshness as an explicit PR checklist item in `workflow-release-process.md` (step 4: README/FEATURES.md, step 5: other related docs — API.md, V2_ROADMAP.md, quick-start.md, MIGRATION_GUIDE.md — only where the change actually affects them) and in `CLAUDE.md`'s PR workflow section.

**This is a checklist item, not an automated gate.** No CI check enforces it (unlike the version bump, which release.yml does enforce). It relies on whoever opens the PR remembering to check — same class of problem as the thing it's fixing. If doc drift recurs, the next fix should probably be automated (e.g. a CI step that fails if `skills/*/`  count doesn't match the count string in README.md/FEATURES.md, or if a new `scripts/*-endpoint*` handler isn't mentioned in API.md) rather than another checklist line.

## Related

- [[release-process]] — where the checklist lives
- `gotcha-propose-footer-instruction-leakage-across-modes.md` — a related but distinct doc-drift issue (docs describing the wrong capture mode as canonical) found in the same session

