---
name: unit-tests-pollute-real-daemon-log
description: lib/logger.ts hardcodes ~/.contextus/logs with no test-isolation override, so tests write real Calibration eval lines with fake projects into the users actual daemon.log
metadata:
  type: gotcha
  tags: ["logging", "test-isolation", "daemon"]
---

# Gotcha: unit tests pollute the real ~/.contextus/logs/daemon.log

**Symptom:** tailing `daemon.log` (e.g. via `contextus watch`) shows `Calibration eval` lines for projects that dont exist in your work, e.g. `project=demo` or `project=test-project`, with timestamps clustered within tens of milliseconds of each other.

**Root cause:** `lib/logger.ts:24` hardcodes `const LOG_DIR = expandHome("~/.contextus/logs")`. `expandHome()` (`lib/config.ts`) always resolves to the real `os.homedir()` — there is no env override or injection seam. `lib/calibration/eval-worker-core.ts:89` calls the real `logCalibrationEval()` (not mocked), and `tests/eval-loop.test.ts` / `tests/eval-worker-core.test.ts` exercise that path with synthetic project names (`demo`, `test-project`). Every `pnpm test` run genuinely appends to whichever machines real `daemon.log`.

**Why it wasnt caught:** `scripts/cost-report.ts:133` already has a comment acknowledging the symptom ("test-project evals (e.g. demo) leak into the log") and filters it out of the cost-report output — but that only hides the symptom downstream in one consumer. Any *other* log-based metric (e.g. the capture-nudge miss-rate log added alongside the Stop-hook capture-gate prototype, `scripts/lib/capture-gate.js`) would need its own filter unless the root cause is fixed, and its easy to forget the filter exists elsewhere in the codebase since its buried in a comment, not a shared guard.

**How to apply:** filed as [equiphealth/claude-contextus#68](https://github.com/equiphealth/claude-contextus/issues/68) — fix is to add a `CONTEXTUS_HOME`/`CONTEXTUS_LOG_DIR`-style env override that `lib/config.ts` respects (defaulting to current behavior when unset), then point the calibration/eval tests at a `fs.mkdtempSync` temp dir the way `tests/integration/*.test.ts` already isolate project directories. Until fixed: dont trust `demo`/`test-project` entries in daemon.log as real usage signal, and any new log-based feature that reads daemon.log/usage.jsonl should filter those project names defensively (or better, note the risk and link to #68) rather than assuming the log is clean.

