/**
 * spawnDetached's logFile option — before this, fireTranscriptMining spawned
 * mine-transcripts.ts with stdio:'ignore', discarding all output. Combined
 * with the watermark bug (#1) and the entrypoint-guard bug (#7), every
 * failure mode of the mining trigger was completely invisible — no log, no
 * signal anywhere (independent review of PR #40, item #8, GH issue #39).
 *
 * Uses a tiny real throwaway script (not the full mining pipeline) spawned
 * through the actual spawnDetached() — proving the fd-duplication approach
 * genuinely works end-to-end (child process, real stdio redirection), not
 * just that the code compiles.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { spawnDetached } = await import('../scripts/lib/daemon-control.js');

/** Poll until `predicate()` is true or timeoutMs elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

test("spawnDetached with logFile captures the child's stdout/stderr instead of discarding it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-spawnlog-'));
  const scriptFile = path.join(dir, 'probe.mjs');
  const logFile = path.join(dir, 'sub', 'probe.log');
  fs.writeFileSync(
    scriptFile,
    `console.log('stdout line');\nconsole.error('stderr line');\nprocess.exit(0);\n`
  );

  try {
    // Both jsPath/tsPath point at the same plain script — isDevMode() is true
    // in this repo checkout (tsconfig.json at root), so resolveLaunch runs it
    // via tsx regardless of the "js" name; tsx executes plain JS fine too.
    spawnDetached(scriptFile, scriptFile, [], { logFile });

    await waitFor(() => fs.existsSync(logFile) && fs.statSync(logFile).size > 0);
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.match(content, /stdout line/);
    assert.match(content, /stderr line/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('spawnDetached with no logFile still defaults to discarding output (unchanged behavior)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-spawnlog-'));
  const scriptFile = path.join(dir, 'probe.mjs');
  const sentinelFile = path.join(dir, 'ran.txt');
  fs.writeFileSync(
    scriptFile,
    `import fs from 'node:fs';\nconsole.log('should not appear anywhere');\nfs.writeFileSync(${JSON.stringify(sentinelFile)}, 'ok');\nprocess.exit(0);\n`
  );

  try {
    spawnDetached(scriptFile, scriptFile, []); // no options — default stdio:'ignore'
    // Confirm the child actually ran (proves absence of a log isn't just "it
    // never spawned") without asserting anything about stdout capture.
    await waitFor(() => fs.existsSync(sentinelFile));
    assert.ok(fs.existsSync(sentinelFile));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
