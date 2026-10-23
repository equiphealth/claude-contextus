---
name: quarantine-detects-mismatch-not-all-embed-failures
description: context-doctor documents quarantined[] as THE tell for phantom re-embed, but it only catches prefix/type mismatches, not YAML syntax errors — same symptom, different undetected cause
metadata:
  type: gotcha
  tags: ["reconcile", "quarantine", "yaml", "context-doctor"]
---

# Gotcha: quarantined[] is not exhaustive for "N files pending forever"

**Symptom**: a captured file with an unquoted colon in its `description` frontmatter field (`"...manual QA: modal button labels..."`) breaks YAML plain-scalar parsing. `daemon.log` shows a clear `WARN async embed failed (reconcile will retry)` with the YAML error, but `POST /reconcile {check:true}` reports `quarantined: []` — the failure is invisible via the documented diagnostic path.

**Root cause**: `context-doctor`'s symptom D ("phantom re-embed") documents checking `quarantined[]` as the way to diagnose a file that retries-and-fails forever. That field is populated by `quarantineMismatches()` (see PR #65, 2026-09-08 — built specifically for the prefix/type mismatch case, e.g. `projectDocs/project-quirks.md` coincidentally starting with a valid category prefix). It has no awareness of YAML parse failures, which fail at a completely different stage (parsing frontmatter before quarantine logic even runs).

**Why it matters**: this is the *second* distinct root cause producing the identical user-visible symptom ("N files to embed, forever, no error surfaced") under the same documented diagnostic step. The first (prefix/type mismatch) is diagnosable via `quarantined[]`; this one (YAML syntax) is not — so `context-doctor`'s advice ("check quarantined[]") gives a false negative for this class of failure. Only `tail ~/.contextus/logs/daemon.log` surfaced it.

**How to apply**: when triaging a stuck/repeatedly-re-embedding file, don't stop at `quarantined: []` looking clean — also grep `daemon.log` for `WARN async embed failed` around that file's capture/notify timestamp. Tracked as a real fix (surface parse failures in `/reconcile`'s response, and/or auto-quote frontmatter scalars containing `:` at capture time) in https://github.com/equiphealth/claude-contextus/issues/70.
