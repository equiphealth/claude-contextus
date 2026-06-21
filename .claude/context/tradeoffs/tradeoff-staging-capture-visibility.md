---
name: staging-capture-visibility
description: Staging mode Write calls are visible in Claude Code UI — no silent file creation available on-platform
metadata:
  type: tradeoff
  tags: [staging, ux, platform-constraint]
---

## The Tension

Staging capture mode instructs Claude to write context files automatically. However, Claude Code displays every Write tool call in the UI — file path, full content, permission prompt (if not auto-approved). This creates visual noise proportional to capture volume.

## Why It Can't Be Hidden (today)

Claude Code's tool-call visibility is a deliberate transparency feature. There is no "silent write" mode or background file API. Every file mutation is shown to the user because:
- Users need to approve/deny tool calls in non-permissive modes
- Audit trail of what Claude changed is a core trust mechanism
- No distinction between "important writes" and "housekeeping writes"

## Impact on Staging Mode

- Each capture adds 20-40 lines of visible output (path + content + confirmation)
- Multiple captures per response multiply the noise
- User attention is split between the actual response and capture artifacts
- The "transparent by design" principle conflicts with "ambient by design"

## Mitigations (current)

- Git staging IS the review gate — users don't need to read captures in real-time
- Context files are small (15-30 lines) so each Write is brief
- Captures happen BEFORE the response, so noise is front-loaded not interleaved

## Future Options (if platform evolves)

- Batch file creation API (one tool call, multiple files)
- "Background writes" category with collapsed UI
- Post-response hook that does the writing (moves noise out of chat flow)
- IDE integration where captures appear in a sidebar, not inline

## Design Principle

Accept the noise as the cost of transparency. The alternative — deferring writes to a post-hook — would sacrifice the "capture happens in-context" guarantee and risk losing insights if the session ends abruptly.
