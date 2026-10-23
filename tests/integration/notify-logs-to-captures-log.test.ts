/**
 * INTEGRATION — a successful /notify embed writes to captures.log, same as
 * /capture, /delete's archive, and the live external-edit watcher already do.
 *
 * Before this fix, handleNotify() never called logCapture() at all. A context
 * file created or edited directly via Write/Edit (picked up by the
 * PostToolUse hook's /notify call, not /capture) embedded successfully but
 * left zero trace in captures.log — meaning anything that reads that log as
 * "proof a capture happened" (the Stop-hook capture-enforcement gate) could
 * never see it, misreporting a real capture as missing.
 *
 * Spawns the REAL daemon as its own OS process (same pattern as
 * watch-contexts-yaml-feedback.test.ts, same reason): `daemon/server.js` is
 * an ESM singleton, and this suite's test files share ONE Node process when
 * run via the `tests/integration/*.test.ts` glob — the FIRST file to import
 * it freezes its HOME-derived paths (CAPTURES_LOG included) for every other
 * file in the same run. A genuinely separate process has its own HOME,
 * independent of import order.
 *
 * Each test uses its OWN fresh project directory (never shares one across
 * tests) — deliberately, after finding that reusing one project/table across
 * multiple tests made a pre-existing LanceDB cold-start consistency gap (the
 * same class upsertRows/createTable/getContentHashes in lib/storage/
 * lance-client.ts now retry and self-heal around — see those comments) far
 * more likely to surface than a single embed against a brand-new table ever
 * does.
 *
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DAEMON_TS = path.resolve(__dirname, '..', '..', 'daemon', 'server.ts');
const DAEMON_PORT = 44822; // dedicated — distinct from watch-contexts-yaml-feedback.test.ts's 44821

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));
let daemonProc: ChildProcess;
const daemonUrl = `http://127.0.0.1:${DAEMON_PORT}`;

async function waitForDaemon(timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${daemonUrl}/health`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`daemon on ${daemonUrl} did not become healthy within ${timeoutMs}ms`);
}

before(async () => {
  daemonProc = spawn('node', ['--import', 'tsx', DAEMON_TS], {
    // CI has neither Ollama (no service started) nor a reliable Transformers.js
    // download (see reconcile-multi-source.test.ts's header) — CONTEXTUS_TEST_FAKE_EMBED
    // bypasses only the model call (lib/embedding/embedder.ts), so chunking,
    // staleness detection, and the real LanceDB upsert this test actually cares
    // about still run for real.
    env: {
      ...process.env,
      HOME: homeDir,
      CONTEXTUS_DAEMON_PORT: String(DAEMON_PORT),
      CONTEXTUS_TEST_FAKE_EMBED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForDaemon();
});

after(async () => {
  daemonProc.kill();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function capturesLogLines(): string[] {
  const logPath = path.join(homeDir, '.contextus', 'captures.log');
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
}

async function notify(
  file: string,
  cwd: string
): Promise<{ ok: boolean; embedded: boolean; reason?: string }> {
  const res = await fetch(`${daemonUrl}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file, cwd })
  });
  return (await res.json()) as { ok: boolean; embedded: boolean; reason?: string };
}

test('/notify writes a captures.log entry on a successful embed', async () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context', 'decisions');
  fs.mkdirSync(contextDir, { recursive: true });
  const file = path.join(contextDir, 'decision-via-write-tool.md');
  fs.writeFileSync(
    file,
    '---\nname: via-write-tool\ndescription: created directly, not through /capture\nmetadata:\n  type: decision\n---\nbody'
  );

  const before = capturesLogLines().length;
  const json = await notify(file, projectDir);
  assert.equal(json.ok, true, `body: ${JSON.stringify(json)}`);
  assert.equal(json.embedded, true, `expected embedded:true, got ${JSON.stringify(json)}`);

  const lines = capturesLogLines();
  assert.equal(lines.length, before + 1, 'exactly one new captures.log line');
  const newest = lines[lines.length - 1];
  assert.match(
    newest,
    /\| project:[0-9a-f]{12} \|/,
    'tagged with this project\'s id, not bare "project"'
  );
  assert.match(newest, /decisions\/decision-via-write-tool\.md/);
  assert.match(newest, /captured via edit \(PostToolUse \/notify\)/);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/notify re-embedding the SAME unchanged content does not write a second captures.log entry', async () => {
  // isStale() correctly skips an unchanged file (embedSingleFile returns
  // embedded:false, reason:'unchanged') — logCapture must only fire on an
  // actual embed, not every /notify call regardless of outcome.
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context', 'decisions');
  fs.mkdirSync(contextDir, { recursive: true });
  const file = path.join(contextDir, 'decision-stays-put.md');
  fs.writeFileSync(
    file,
    '---\nname: stays-put\ndescription: embedded once, then re-notified unchanged\nmetadata:\n  type: decision\n---\nbody'
  );

  const first = await notify(file, projectDir);
  assert.equal(first.ok, true, `body: ${JSON.stringify(first)}`);
  assert.equal(first.embedded, true, `expected embedded:true, got ${JSON.stringify(first)}`);

  // A real user re-saving identical content seconds (at minimum) after the
  // first save is the only realistic case this matters for — nobody edits
  // the same file twice within milliseconds of themselves. Back-to-back
  // machine-speed /notify calls can outrun LanceDB's own read-after-write
  // visibility for the row this exact test just inserted, which is a
  // genuine but unrealistic stress-test artifact, not a real-world gap.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const before = capturesLogLines().length;
  const second = await notify(file, projectDir);
  assert.equal(second.embedded, false);
  assert.equal(second.reason, 'unchanged');
  assert.equal(capturesLogLines().length, before, 'no new line for a no-op notify');

  fs.rmSync(projectDir, { recursive: true, force: true });
});
