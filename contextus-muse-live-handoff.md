# Muse Phase 1: live handoff (user-present runs)

Run in a NORMAL terminal (not sandboxed). No production daemon is running
(other sessions shut down) — step 0 starts a scratch one via the new neutral
path, which doubles as its first real (non-hermetic) test. Paste back each
command + its output.

Preconditions: `muse --version` (record it), `node --version` (≥22).

## 0. Neutral sync + scratch daemon (also: first real sync test)

```bash
cd /Users/Anthony.Dawson/src/contextus
node scripts/sync-neutral-daemon.js
# expect: "deps installed", "dist built with local tsc", "neutral daemon 0.20.0 ready"
# first run takes ~2-4 min (full npm install + tsc); paste back the whole output
node ~/.contextus/daemon/dist/daemon/server.js > /tmp/ctx-daemon.log 2>&1 &
echo $!   # record the PID
sleep 30; curl -s -m 10 http://127.0.0.1:37800/health | head -c 300; echo
# expect: {"status":"ok","version":"0.20.0",...,"modelLoaded":true,...}
# if modelLoaded is false, wait 60 s and retry (cold Ollama model load)
```

Leave this daemon RUNNING — steps 1–6 all need it (setup reuses it, hooks
call it, step 6 queries it). Teardown is the last section of this file.

## 1. B1 — lean install + approve + hooks fire

```bash
cd /Users/Anthony.Dawson/src/contextus
git archive HEAD | tar -x -C /tmp/ctx-bundle
muse plugins validate /tmp/ctx-bundle        # expect: valid ... skills=22 hooks=4 (+ multiple-manifests warning)
muse plugins install /tmp/ctx-bundle          # record output verbatim
muse plugins inspect contextus                # expect: hooks review_needed
muse plugins approve contextus               # record output verbatim
muse plugins inspect contextus                # expect: hooks trusted_enabled
```

Then open a NEW Muse session in `/tmp/muse-handoff-proj` (fresh dir) and send
any prompt. **Expect:** the model itself brings up setup — the SessionStart
nudge rides `additionalContext` (model context, NOT a user-visible banner),
so the observable is the model telling you to run `/contextus-setup`, quoting
the "Setup needed ... setup has not been completed in this project" wording.
(This is also the B4 post-approve half: hooks firing at all. The H6
*systemMessage* rendering check is separate — see step 5.)
If the model never mentions setup: either the hook didn't fire, or the model
dropped injected context. Distinguish with the manual hook run below and
paste back both results.

```bash
HOOK=$(echo /Users/Anthony.Dawson/.local/share/muse/plugins/cache/local/contextus/*/package/adapter/muse-code/session-start.js)
cd /tmp/muse-handoff-proj
time echo '{"cwd":"/tmp/muse-handoff-proj","session_id":"handoff-nudge","source":"startup"}' | node "$HOOK"
# expect: exit 0 in under ~10 s (daemon is up), JSON with hookSpecificOutput.additionalContext
# containing "Setup needed: ... setup has not been completed in this project"
```

- Nudge JSON present → hook code + delivery path work; the TUI session either
  predates approval or the model dropped the context (retry: brand-new session
  started AFTER `approve`, one plain prompt like `hi`, then ask the model
  "was any context injected about setup?").
- Empty/crash/timeout → paste the exact output; that's a hook defect, not a model quirk.

## 2. B4 — pre-approve honesty (do BEFORE step 1's approve on a second profile if possible)

With the plugin installed but NOT approved: skills (e.g. `contextus-setup`)
must be visible/runnable, and NO hook output may appear (hooks are inert
until approved). One line back: what you saw.

## 3. B5 — `plugins update` gates (closes O12)

```bash
muse plugins update --help    # record syntax first; exact command TBD from help
```

Pick the documented form, run `muse plugins update contextus` (or the
path form), then re-run step 1's new-session check. Record verbatim whether
update re-gated on approval and whether hooks still fire.

## 4. H1-TUI — merged injection lands in a reply (fact-use probe)

In the approved Muse session from step 1, run setup, then capture one pattern:

```
/contextus-setup --host muse     (or: run the setup skill; expect: daemon reused, AGENTS.md stanza, stamp, corpus scaffolded)
```

Add one real pattern file under `/tmp/muse-handoff-proj/.claude/context/decisions/`:

```markdown
---
name: handoff-probe-fact
description: handoff verification fact about the fictional FrobnicateDB adapter
metadata:
  type: decision
  tags: [handoff, probe]
---

The FrobnicateDB adapter retries idempotent writes three times with jittered backoff before surfacing an error to the caller.
```

Wait one session (or run the skill that triggers reconcile), then send in a NEW session:
`How many times does the FrobnicateDB adapter retry idempotent writes, and with what strategy?`

**Pass:** reply says three times with jittered backoff (fact USE — never
repeat a marker). **Fail:** no injection, or a quote-style non-answer.
Paste back the reply (or its relevant lines).

Cleanup afterwards (keeps the production daemon clean):

```bash
curl -s -X POST http://127.0.0.1:37800/delete -H 'content-type: application/json' \
  -d '{"relPath":"decisions/handoff-probe-fact.md","cwd":"/tmp/muse-handoff-proj"}'
muse plugins remove contextus    # if you don't want to keep it installed
rm -rf /tmp/muse-handoff-proj /tmp/ctx-bundle
```

## 5. H6-TUI — systemMessage rendering per source

In a Muse TUI session with the plugin approved: start, resume, clear, compact,
fork (as available). For each: did the SessionStart state render visibly, and
did anything leak into model context that should have been user-visible only?
One line per source.

## 6. M1 daemon-log half (expansion naming in daemon logs)

Step 0's scratch daemon serves this — no config edits, no other sessions live:

```bash
curl -s -m 60 -X POST http://127.0.0.1:37800/query -H 'content-type: application/json' \
  -d '{"prompt":"How do hooks handle token budgets?","cwd":"/tmp/muse-handoff-proj","agent":"muse","hookEvent":"UserPromptSubmit"}' | head -c 400; echo
grep -E "expansion" ~/.contextus/logs/daemon.log | tail -n 5
```

**Pass:** log names the expansion provider + model for that query (whatever
the active provider is — naming, not Meta specifically, is what's verified
here; the Meta path itself is verified in-process). Paste back the log lines.

## Deferred (not handoff-safe)

- **M3 multi-touchpoint grading:** needs a calibration campaign on a live
  daemon — a procedure of its own, not a 5-minute handoff item.
- **N1 live half / B3:** need both hosts capturing or a Node-less machine;
  code already determines N1's outcome (keep `.claude/`).

## Cleanup (last, after everything above)

```bash
kill $(cat ~/.contextus/runtime/daemon.pid)   # or the PID recorded in step 0
sleep 2; curl -s -m 5 http://127.0.0.1:37800/health || echo "port free"
rm -rf /tmp/muse-handoff-proj /tmp/ctx-bundle  # if still present
# Optional: remove the one junk audit registration (harmless either way)
cp ~/.contextus/data/projects.json ~/.contextus/data/projects.json.pre-handoff-bak
python3 -c "import json; p='$HOME/.contextus/data/projects.json'; d=json.load(open(p)); dead={'/tmp/muse-handoff-proj','/private/tmp/muse-handoff-proj','/tmp/ctx-bundle'}; d={k:v for k,v in d.items() if 'phase1-live' not in str(v) and v.get('path') not in dead}; json.dump(d, open(p,'w'), indent=2); print('remaining:', len(d))"
```

Only kill the daemon here. Everything before this point needs it running. (The
2026-10-27 audit verdict — one junk registration, zero log/usage traces — is
recorded in `contextus-muse-audit-2026-10-27.md`; nothing else to do there.)
- **N1 live half:** needs both hosts capturing into one corpus; code already
  determines the gate outcome (daemon reads `.claude/` only — keep it).
- **B3 fresh profile:** needs a machine without Node/package managers.

## Fixture rule (locked)

`.tmp/phase1-live/*/run.sh` are hermetic BY CONSTRUCTION (fake HOME + dead-port
`CONTEXTUS_DAEMON_URL` + `CONTEXTUS_NO_SPAWN=1`) — safe to run anywhere, but
they prove the down-path/fixture halves only, never socket/TUI halves.
