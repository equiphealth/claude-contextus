---
name: context-status-run-instructions-clarified
description: context-status reference.md had two competing implementation paths (manual /introspect curl+hash vs the actual status.ts script) and never stated the script hashes process.cwd() by default
metadata:
  type: implementation
  tags: ["context-status", "docs", "cwd", "project-hash"]
---

# Implementation: clarified context-status run instructions

**What changed**: `skills/context-status/reference.md`'s `## Implementation` section was rewritten. Previously it presented two competing, ambiguous paths for an LLM to follow:
1. A manual `curl .../introspect?project=$(sha256 of cwd)` snippet, presented right after `## What It Shows` as if it were something to run directly.
2. The actual runnable command (`npx tsx scripts/cli/status.ts`), buried three sections later under `## Cost Mode` as if it only applied to cost reporting.

Neither path stated the actual gotcha: `status.ts` (confirmed at `status.ts:320`) hashes the shell's `process.cwd()` to resolve the target project **unless** `--project` is passed. So an LLM invoking the skill from the wrong Bash cwd (e.g. still in `claude-contextus` while trying to check a linked project's status) silently gets the wrong project's dashboard or an empty one — no error, no signal something went wrong.

**Fix**: reference.md now has one explicit entry point ("Run the CLI", still cross-referenced from the top of `## Implementation`) with an explicit "Where to run it from" callout: either `cd` into the target project first, or pass `--project <path-or-name>` (accepts a plain path/name — never compute the hash by hand). The manual `/introspect` curl block is kept only as background on what the script does internally, explicitly labeled "you should not need to run this yourself."

**Why this mattered**: this is the same root confusion as [[gotcha-context-status-should-use-daemon-not-script]] (tracked in issue #69) — an LLM given two plausible-looking instructions with no explicit precedence will guess, and guess wrong when the target project isn't the current cwd. Issue #69 will fix this properly by routing through `/introspect` directly; this doc fix is the interim mitigation so the existing script-based path is at least unambiguous.

**Not done**: issue #69's actual endpoint migration is still open — this only fixes the documentation ambiguity in the current script-based implementation.
