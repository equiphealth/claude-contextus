---
name: context-doctor
description: Diagnose contextus issues — daemon health, corpus state, stale patterns (--stale), noisy patterns (--noisy), eval queue status. Maps symptoms to deterministic checks.
---

# Context Doctor

Troubleshooting for contextus. The guiding principle: **trust deterministic ground
truth over the transcript.** The daemon log, `/health`, `/reconcile check`, and a
`search.ts` replay tell you what actually happened — the chat does not.

## When to Use

- Setup looks done but nothing injects.
- Retrieval "feels wrong" — too sparse, too noisy, or naming files you didn't expect.
- Session-start surfaces "N file(s) can't embed" or a corpus keeps re-embeding.
- A `Context: used:` footer cites a file that wasn't actually injected.

## The diagnostic primitives (run these, don't guess)

All replays use the repo-local `tsx` **by path**, from the TARGET project — NOT
`pnpm` (the repo needs Node 22; a wrong-Node shell errors out, and `pnpm --prefix`
sets cwd to contextus and inspects the *wrong* corpus).

```bash
cd <target-project>
TSX=~/src/claude-contextus/node_modules/.bin/tsx

# 1. Is the daemon alive + warm? (provider, model, warmupError)
curl -s 127.0.0.1:37800/health | jq

# 2. What's the corpus state for THIS project? (new/stale/fresh/empty + quarantined[])
PROJECT_ID=$(echo -n "$PWD" | sha256sum | cut -c1-12)
curl -s -X POST http://127.0.0.1:37800/reconcile \
  -H 'Content-Type: application/json' \
  -d "{\"project\":\"${PROJECT_ID}\",\"cwd\":\"$PWD\",\"check\":true}" | jq

# 3. Replay a real query — shows scores AND the per-project floor + below-floor flags
$TSX ~/src/claude-contextus/scripts/search.ts "your actual prompt here"

# 4. The source of truth for live retrievals (scores, no-inject decisions)
tail -30 ~/.contextus/logs/daemon.log
```

## Symptom → diagnosis map

These are the four "looks-broken-but-isn't" (or genuinely-broken) cases seen during
the automation migration. Each has a deterministic tell.

### A. "No injections at all"

1. `/health` → `modelLoaded: false` with a `warmupError` string ⇒ **provider down**
   (Ollama not running / model missing / dim mismatch). Fix the provider; the daemon
   recovers on the next session.
2. `/health` healthy but `search.ts` shows top hits flagged `⚠ below <floor> floor`
   ⇒ **below-floor false negative**, NOT a bug. The corpus simply isn't matching this
   prompt above the gate. Either the floor is too high for your corpus
   (`/context-calibrate --floor` to retune, per-project) or the prompt is too terse
   (see D).
3. `/reconcile check` → `state: "empty"` ⇒ **wrong corpus / nothing embedded** (see B).

### B. "Wrong corpus embedded" — the `--prefix` trap

Tell: `/reconcile check` from the project reports `empty`/`new` even though
`.claude/context/` is full, OR `search.ts` returns patterns from a *different*
project. Cause: a past embed ran with `pnpm --prefix ~/src/claude-contextus`, which
sets cwd to the contextus repo and embeds **its** corpus under the wrong project key.
Fix: re-embed from the project via tsx-by-path:

```bash
cd <target-project>
$TSX ~/src/claude-contextus/scripts/embed-contexts.ts
```

Per-project corpora live at `~/.contextus/data/<project>/` — confirm the right one
has rows.

### C. "Footer names a file that wasn't injected" — hallucinated provenance

Tell: the `Context: used:` footer cites `foo.md` but the daemon log for that prompt
shows different files (or none). Since the footer fix, the provenance instruction is
**daemon-generated and whitelisted** (`renderFooterInstruction` lists exact files +
scores). So a mismatch means one of:
- The daemon didn't inject for that prompt (below floor) but the model fabricated a
  footer from memory ⇒ confirm via daemon.log; if there was no injection, there
  should be no footer. Re-check the awareness-hook is `propose:`-only.
- A stale daemon is running old code ⇒ `/health` uptime + restart (see "Restart").

### D. "Phantom re-embed" — corpus re-embeds 1 file every session

Tell: session-start repeatedly reports re-embedding the same count; `/reconcile
check` shows a non-empty `quarantined[]`. Cause: a context file with a
prefix/type mismatch (e.g. a `decisions/` file with `type: pattern`) can't embed, so
it shows as perpetually "new." This no longer aborts the whole embed — it's
quarantined and reported. Fix: open each path in `quarantined[]` and correct its
frontmatter `type` to match its directory (see `/create-context` for the schema),
then re-embed.

## Terse-prompt dilution (not a fault — a known limit)

If `search.ts` scores well for a natural-language question but poorly for the same
intent in keywords, that's expected: we embed the whole prompt as one mean-pooled
vector, so terse/exact-term queries (e.g. `getLogger`) retrieve worse until v2 hybrid
search. Ask naturally.

## Restart the daemon

```bash
# Graceful: session-start auto-recovers a dead/wedged daemon next session.
# Manual kick (rarely needed):
kill $(cat ~/.contextus/runtime/daemon.pid) 2>/dev/null
# next session-start (or any hook) respawns it
```

## Phase 2: Usage-Driven Health Checks

When Phase 1 (usage evaluation) is active and `usage-ratings.jsonl` exists, add these checks:

### E. "Stale patterns" — not retrieved in 6+ months

Tell: `/context-stats --window 180` shows patterns with `lastRetrieved: null` or older than 180 days.

**Cause:** Pattern is obsolete, has poor keywords, or is genuinely niche.

**Fix:**
- Review content — if still relevant, improve keywords to help discoverability
- If obsolete, archive: `/context-archive --stale`
- If niche but correct, leave as-is (rare retrieval is expected)

### F. "Noisy patterns" — high retrieval, low usage (score < 0.3)

Tell: `/context-stats` shows patterns with `retrievalCount >= 10` but `avgWeightedScore < 0.3`.

**Cause:** Generic keywords causing over-retrieval, or content no longer matches user's actual needs.

**Fix:**
- Rewrite for specificity (narrow scope, add targeted keywords)
- Split into multiple patterns if covering too many topics
- Archive if the pattern is no longer relevant
- Check if similar patterns exist and merge duplicates

### G. "Duplicate patterns" — same content, different files

Tell: `/context-stats` combined with content-hash comparison (coming in `/context-doctor` CLI).

**Cause:** Pattern was manually copied, or evolved independently in different categories.

**Fix:** Use `/context-merge <file1> <file2>` to combine into one pattern, archive the duplicate.

### H. "Eval queue growing unbounded" — jobs enqueued but not draining

Tell: Check `~/.contextus/data/<project>/.eval-queue.jsonl` line count — if growing unbounded, eval worker isn't running.

**Cause:** Daemon eval loop not started, or eval model provider unreachable.

**Fix:**
1. Check daemon logs for eval worker errors: `tail ~/.contextus/logs/daemon.log | grep eval`
2. Verify eval provider is reachable (default: Bedrock Haiku via AWS credentials)
3. If provider is down, jobs will retry on next daemon restart
4. If queue is massive (>1000 lines), truncate: `tail -100 .eval-queue.jsonl > .eval-queue.tmp && mv .eval-queue.tmp .eval-queue.jsonl`

## Related

- `/context-status` — the impact dashboard ("how's it helping?"). Doctor answers "why isn't it working?"
- `/context-calibrate --floor` — retune the per-project injection floor.
- `/rebuild-embeddings` — force a full re-embed when staleness looks wrong.
- `/context-stats` — usage analytics (shows stale/noisy patterns for checks E and F).
- `/context-review` — interactive curation workflow for problem patterns.
- `/context-archive --stale` — archive patterns failing staleness check.
