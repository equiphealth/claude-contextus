---
name: context-doctor
description: Diagnose contextus when something looks broken — daemon down, no injections, wrong corpus, phantom re-embeds, or a footer naming a file that wasn't injected. Maps each symptom to a real, deterministic check.
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

## Related

- `/context-status` — the impact dashboard ("how's it helping?"). Doctor answers
  "why isn't it working?"
- `/context-calibrate --floor` — retune the per-project injection floor.
- `/rebuild-embeddings` — force a full re-embed when staleness looks wrong.
