# Muse Phase 1: live handoff (user-present runs)

Run in a NORMAL terminal (not sandboxed). Your production daemon stays up
throughout — nothing here restarts it. Setup reuses it (never restarts one).
Paste back each command + its output.

Preconditions: `muse --version` (record it), `node --version` (≥22),
`curl -s -m 5 http://127.0.0.1:37800/health` shows `"modelLoaded":true`.

## 0. Audit verdict (done 2026-10-27)

Fixture contact with the production daemon: exactly ONE `projects.json`
registration (`.../.tmp/phase1-live/h6-sources/probeproj`,
lastSeen 2026-10-27T15:48:16Z). No log traces, no usage signals, no
last-injection files. The 20 h1h2 probe files were archived via `/delete`
(ok:true × 20) as a precaution — rows were never ingested (nothing reached
the daemon from the in-process probe), and the files live in `.tmp/`
(gitignored scratch), so nothing of value moved. Optional cleanup of the
junk registration (backup first):

```bash
cp ~/.contextus/data/projects.json ~/.contextus/data/projects.json.pre-handoff-bak
python3 -c "
import json, os
p = os.path.expanduser('~/.contextus/data/projects.json')
d = json.load(open(p))
d = {k: v for k, v in d.items() if 'phase1-live' not in str(v)}
json.dump(d, open(p, 'w'), indent=2)
print('remaining:', len(d))
"
```

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
any prompt. **Expect:** a visible "Setup needed: the Contextus daemon is not
reachable / setup has not been completed" nudge (SessionStart fired — this is
also the B4 post-approve half and the H6 systemMessage rendering check).
Paste back whether the nudge rendered and its exact wording.

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

## Deferred (not handoff-safe)

- **M1/M3 daemon-level:** needs a scratch daemon or production config edits —
  explicitly out of scope while live Claude sessions run here. M1 provider
  path is verified in-process (2 variants, `meta/muse-spark-1.3-contributor`,
  13.5 s); M4 is fully PASS (production `/health` corroborates nomic).
- **N1 live half:** needs both hosts capturing into one corpus; code already
  determines the gate outcome (daemon reads `.claude/` only — keep it).
- **B3 fresh profile:** needs a machine without Node/package managers.

## Fixture rule (locked)

`.tmp/phase1-live/*/run.sh` are hermetic BY CONSTRUCTION (fake HOME + dead-port
`CONTEXTUS_DAEMON_URL` + `CONTEXTUS_NO_SPAWN=1`) — safe to run anywhere, but
they prove the down-path/fixture halves only, never socket/TUI halves.
