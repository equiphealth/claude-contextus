---
name: capture-footer-scope-tag
description: capture footer now tags scope [user]/[project] since path alone is ambiguous
metadata:
  type: decision
  tags: ["capture", "footer", "ux"]
---

# Decision: capture footer tags scope, not category

**What changed**: The `Context: captured: <relPath>` footer became `Context: captured [<scope>]: <relPath>`, where `<scope>` is `user` or `project`.

**Why**: The user pointed out the footer gave no indication of where a capture landed. Category (gotcha/decision/etc.) was already visible in the path itself (`gotchas/gotcha-foo.md`), so tagging that would be redundant. But **scope** is genuinely ambiguous: a project-scope capture is shown as a relative path (`gotchas/gotcha-foo.md`, relative to `.claude/context/`), and a user-scope capture is shown as an absolute path (`~/.contextus/context/reference/reference-foo.md`) per docs/dev/SILENT_CAPTURE_V2.md — but nothing enforces that distinction consistently, and at a glance both just look like a path. The `[scope]` tag makes it unambiguous without repeating information already in the path.

**Where this lives**:
- `prompts/staging-footer.txt` — canonical instruction text Claude reads to know the footer contract
- `scripts/lib/capture-gate.js` — `CAPTURE_ACK_RE` regex updated to `/Context:\s*(captured|propose)(\s*\[[^\]]+\])?:/i` (bracket is optional, so old bare-format footers from before this change still satisfy the Stop-hook gate)
- `tests/capture-gate.test.ts` — covers both bracketed and legacy bare format
- Docs/config comments updated to match: `plugin.jsonc`, `examples/contextus.jsonc`, `skills/configure/reference.md`, `docs/dev/SILENT_CAPTURE_V2.md`

**Backward compatibility**: the bracket group in the regex is optional specifically so this isn't a breaking change to the Stop-hook capture-gate prototype (`decision-capture-enforcement-needs-a-stop-hook-not-wording.md`) — old-format footers already in flight (or from a stale prompt cache) still count as a valid capture ack.

**Not done**: `Context: propose:` footer (a different mode) was left untouched — it names a topic, not a written file, so scope ambiguity doesn't apply the same way.
