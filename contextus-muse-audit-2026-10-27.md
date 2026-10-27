# Audit: did Phase 1 fixture runs touch the production daemon?

Date: 2026-10-27. Run these in a NORMAL terminal (not sandboxed).

## Why this exists

Phase 1 Muse verification ran hook fixtures in a sandbox where loopback is
blocked (bind/connect `EPERM`). All daemon probes observed down — EXCEPT one
run that briefly observed daemon-up. The sandbox proxy intermittently forwards
loopback, so a `fireReconcile` / `checkCorpus` / `/query` POST from a fixture
could theoretically have landed on the production daemon (which serves live
Claude sessions on `127.0.0.1:37800`). Writes to `~/.contextus/` from fixtures
were hermetic (fake `HOME`), so only daemon-side state is in question.

What fixtures sent over HTTP (all with these markers — grep for them):

- `cwd` values (go over the wire, may appear in daemon logs):
  - `/Users/Anthony.Dawson/src/contextus/.tmp/phase1-live/h4h5-stop/probeproj`
  - `/Users/Anthony.Dawson/src/contextus/.tmp/phase1-live/h6-sources/probeproj`
  - `/Users/Anthony.Dawson/src/contextus/.tmp/phase1-live/h7-capacity/probeproj`
  - `/Users/Anthony.Dawson/src/contextus/.tmp/phase1-live/h2-failopen/probeproj`
  - `/Users/Anthony.Dawson/src/contextus/.tmp/phase1-live/h1h2-pipeline/proj`
- `session_id` values: `stop-f1`, `stop-f2`, `h6-startup|resume|clear|compact|fork`,
  `cap-t1`, `cap-t2`, `cap-t3`, `h2-down`, `t-startup|clear|emit|g|re`
- Known probe project hash: `5b4d59df7c39` (stop fixture; others unrecorded — use paths/timestamps)
- Window (UTC, widen if your clock differs): **2026-10-27 15:30–17:00**

## Step 1 — daemon alive?

```bash
cat ~/.contextus/runtime/daemon.pid
ps -p $(cat ~/.contextus/runtime/daemon.pid) -o pid,etime,command
curl -s -m 5 http://127.0.0.1:37800/health | head -c 500; echo
```

## Step 2 — log scan (the core check)

```bash
grep -E "phase1-live|probeproj" ~/.contextus/logs/daemon.log | awk '$0 >= "2026-10-27 15:30" && $0 <= "2026-10-27 17:00"' | head -n 20
echo "--- errors ---"
grep -E "phase1-live|probeproj|5b4d59df7c39" ~/.contextus/logs/errors.jsonl | head -n 20
echo "--- usage ---"
grep -E "stop-f1|stop-f2|h6-|cap-t|h2-down|5b4d59df7c39" ~/.contextus/logs/usage.jsonl | head -n 20
```

Clean = all three empty (the one anomalous up-blip was a GET /health, which
logs nothing — expect at most nothing).

## Step 3 — registration and storage side effects

```bash
echo "--- projects.json ---"
python3 -c "import json; d=json.load(open('$HOME/.contextus/data/projects.json')); print([v for v in d.values() if 'phase1-live' in str(v)])"
echo "--- tables by mtime (anything new in the window is suspect) ---"
ls -la --time-style=long-iso ~/.contextus/data/ | head -n 30
echo "--- last-injection / session files with probe session ids ---"
grep -l -E "stop-f|h6-|cap-t|h2-down|\"t-" ~/.contextus/runtime/*.json 2>/dev/null | head
```

## Step 4 — verdict

- **Clean** (expected): steps 2–3 empty. Nothing further. Fixture isolation
  (`CONTEXTUS_DAEMON_URL=http://127.0.0.1:9` + `CONTEXTUS_NO_SPAWN=1`, locked
  2026-10-27) prevents recurrence — future fixture runs cannot dial or spawn.
- **Pollution** (a probe cwd/hash/session appears): it is bounded to the probe
  project(s) above — no production corpus files were touched (fixtures only
  sent their own probe paths). Clean per file via the daemon's own endpoint
  (never raw `rm` — the endpoint also drops the Lance rows):

```bash
# Per probe file (20 files, probe-<topic>.md). cwd must exist (it does: .tmp intact).
for t in hook-lifecycle token-budgets capacity-guard truncation-policy session-start injection-floor query-expansion rerank-scores provenance-footer near-miss-notice stop-logging watch-reembed skill-routing setup-stamp agents-stanza daemon-health keyword-fallback hybrid-search usage-signals model-warmup; do
  curl -s -m 10 -X POST http://127.0.0.1:37800/delete \
    -H 'content-type: application/json' \
    -d "{\"relPath\":\"probe-$t.md\",\"cwd\":\"$HOME/src/contextus/.tmp/phase1-live/h1h2-pipeline/proj\"}" | head -c 200; echo
done
```

Adjust the `cwd` prefix if your checkout lives elsewhere. Then re-run steps
2–3 to confirm, and remove the junk `projects.json` entry only if one exists
(back it up first: `cp projects.json projects.json.pre-audit-bak`).
