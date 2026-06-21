---
name: capture-noise-reduction
description: Reduce staging capture UI noise via daemon endpoint or MCP tool instead of raw Write calls
metadata:
  type: decision
  tags: [staging, ux, daemon, mcp]
---

## Problem

Staging mode uses Write tool calls to create context files. Each Write shows full file path + full content + approval prompt in the Claude Code UI. Multiple captures per turn multiply the noise, drowning the actual response.

## Options Evaluated

### 1. Background subagent

Spawn a background agent to do the writes. Agent tool calls are grouped/collapsed — main conversation flow stays clean.

- Pro: Available today, no code changes to contextus
- Con: Agent startup overhead (~1-2s), still visible in sidebar, overkill for writing one file
- Con: Agent needs full context of what to capture (prompt gets large)

### 2. Daemon HTTP endpoint (`POST /capture`)

Claude calls a single Bash `curl` (or fetch via hook) to the daemon. Daemon writes the file, updates CONTEXT.md, triggers re-embed.

- Pro: One tool call instead of Write + Edit
- Con: Still shows the curl command with JSON body (content visible)
- Con: Daemon needs new endpoint + file-write logic outside its current scope

### 3. MCP tool (`contextus:capture`)

Contextus registers as an MCP server exposing a `capture_context` tool. Claude calls it with structured params (category, slug, description, body). Server-side write.

- Pro: Cleanest integration — one tool call, parameters shown compactly
- Pro: MCP tools show name + params, not full file content rendered inline
- Pro: Can bundle index update + re-embed in the same call
- Pro: Validates format server-side (no more "embed gate rejects it" failures)
- Con: Requires contextus to run as MCP server (or extend daemon to serve MCP)
- Con: MCP tool calls still require approval unless auto-allowed

### 4. Post-response hook (Stop hook)

Capture instructions embedded in response metadata; Stop hook parses and writes files after Claude finishes.

- Pro: Zero in-response noise
- Con: Loses "capture in-context" guarantee — session crash = lost captures
- Con: Hook has no access to Claude's reasoning about WHAT to capture
- Con: Parsing structured output from free-text response is fragile

## Recommendation

**MCP tool (option 3)** is the best long-term path. It:
- Reduces 2-3 tool calls to 1
- Validates format server-side
- Bundles write + index + embed atomically
- Fits naturally (contextus daemon is already a localhost HTTP server — MCP is HTTP+JSON)

**Daemon endpoint (option 2)** is the pragmatic stepping stone — add `POST /capture` now, wrap it in MCP later.

**Background subagent (option 1)** is worth testing immediately as a zero-code-change experiment.

## Implementation Path

1. Add `POST /capture` endpoint to daemon (accepts category, slug, description, body, tags)
2. Endpoint writes file, appends to CONTEXT.md, triggers single-file re-embed
3. Staging footer instructs Claude to `curl localhost:37800/capture` instead of Write
4. Later: expose as MCP tool for proper integration
