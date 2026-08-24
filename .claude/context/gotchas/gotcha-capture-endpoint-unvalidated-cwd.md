---
name: capture-endpoint-unvalidated-cwd
description: daemon /capture and /delete accept any non-empty string as cwd with no path.isAbsolute or existsSync check, so a bad cwd silently writes garbage and permanently pollutes projects.json + LanceDB instead of failing
metadata:
  type: gotcha
  tags: ["daemon", "capture", "cwd", "validation", "robustness"]
---

# Problem

`executeCaptureRequest` (`daemon/server.ts:840`) only checks `typeof body.cwd === 'string' && body.cwd` — truthy non-empty string. No `path.isAbsolute(cwd)`, no `fs.existsSync(cwd)`. From there `cwd` flows into `path.join(cwd, ...)` for the write path (`fs.mkdirSync(..., {recursive:true})` creates whatever tree results) and into `registerProject(id, cwd)` (`lib/workspace.ts:194`), which `path.resolve()`s it and permanently persists it to `~/.contextus/data/projects.json`.

## How this actually happened (2026-08-19)

Calling `/capture` via curl with the JSON body inside a **single-quoted heredoc** (`curl ... --data @- <<'PAYLOAD'`) — quoting the heredoc delimiter disables ALL shell expansion inside, including a `"cwd":"$(pwd)"` field that was meant to expand. The literal 4-character string `$(pwd)` got sent as `cwd`.

Result:
- File written to `<repo>/$(pwd)/.claude/context/<category>/<slug>.md` (a directory literally named `$(pwd)`), not `.claude/context/`
- Response still returned `{"ok": true, ...}` — no error, no warning
- `~/.contextus/data/projects.json` got a permanent bogus entry (`path.resolve('$(pwd)')` relative to the daemon's own process cwd, which happened to be the repo root, so it resolved to `<repo>/$(pwd)`)
- The async embed step completed before the mistake was caught, landing 6 chunks in the shared LanceDB under that bogus project hash — confirmed via `GET /introspect?project=<hash>` showing `corpus.chunks: 6` with no file left on disk

## Fix (workaround until upstream validates cwd — see equiphealth/claude-contextus#46)

**When building a /capture payload with lots of markdown/backticks in the body, write the JSON to a temp file first and pass it with `curl --data @/tmp/file.json`.** Don't try to interpolate `$(pwd)` inside a heredoc or a large `-d '...'` string — too easy to get the quoting wrong, and the daemon won't catch it for you.

```bash
# SAFE pattern
cat > /tmp/capture.json <<'EOF'
{"slug":"...", "cwd": "/absolute/path/you/already/know", ...}
EOF
curl -s -X POST http://127.0.0.1:37800/capture -H 'content-type: application/json' --data @/tmp/capture.json
```

If a bad cwd DOES slip through, cleanup requires manual intervention (no supported endpoint):
1. Remove the bogus entry from `~/.contextus/data/projects.json` by hand
2. Purge orphaned LanceDB rows: write a one-off script calling `deleteByProject(hash)` from `lib/storage/lance-client.ts:325` (not exposed via any endpoint or CLI script currently)

## Related

- equiphealth/claude-contextus#46 — upstream fix request (validate cwd, expose deleteByProject)
- [[gotcha-propose-footer-instruction-leakage-across-modes]] — unrelated bug, same session

