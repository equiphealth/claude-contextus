/**
 * INTEGRATION — watch-contexts.js (the PostToolUse hook) surfaces invalid
 * frontmatter YAML back to whoever/whatever just wrote the file, instead of
 * discarding /notify's response and always emitting a bare {continue:true}.
 *
 * Before this fix there was no feedback loop at all for a file edited through
 * Claude Code's own tools: the hook fired /notify, threw away the response,
 * and emitted {continue:true} unconditionally. A bad edit was only ever
 * discoverable later via the daemon log or the next SessionStart message —
 * never in the same turn that made the edit.
 *
 * Spawns the REAL daemon (daemon/server.ts) as its own OS process on a
 * dedicated port, and spawns the actual watch-contexts.js file as a second,
 * sibling child process pointed at it via CONTEXTUS_DAEMON_URL — proving the
 * real hook-to-daemon round trip, not just each side's logic in isolation.
 *
 * Deliberately NOT an in-process `http.createServer` (as other integration
 * tests use): this test's own process spawns watch-contexts.js as a CHILD,
 * and child processes here cannot open a loopback connection back to a
 * socket their own parent bound in-process — only to a genuinely separate
 * process (sibling or otherwise). Binding the server in-process would make
 * watch-contexts.js's connection attempt to it hang indefinitely.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCH_CONTEXTS_JS = path.resolve(__dirname, '..', '..', 'scripts', 'watch-contexts.js');
const DAEMON_TS = path.resolve(__dirname, '..', '..', 'daemon', 'server.ts');
const DAEMON_PORT = 44821; // dedicated, unlikely to collide with the real daemon (37800)

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));

let projectDir: string;
let daemonProc: ChildProcess;
const daemonUrl = `http://127.0.0.1:${DAEMON_PORT}`;

/** Poll /health until the freshly-spawned daemon process is actually ready. */
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
    env: { ...process.env, HOME: homeDir, CONTEXTUS_DAEMON_PORT: String(DAEMON_PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForDaemon();
});

after(async () => {
  daemonProc.kill();
  fs.rmSync(homeDir, { recursive: true, force: true });
});

function runWatchContexts(filePath: string, cwd: string) {
  const res = spawnSync('node', [WATCH_CONTEXTS_JS], {
    input: JSON.stringify({ cwd, tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, CONTEXTUS_DAEMON_URL: daemonUrl }
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = res.stdout.trim() ? JSON.parse(res.stdout.trim()) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, stdout: res.stdout, parsed, stderr: res.stderr };
}

/**
 * Pre-warm a project's table via a throwaway valid file BEFORE the test's
 * real file+hook invocation. First-time embedding in a brand-new project
 * creates a brand-new LanceDB table, which can take longer than
 * watch-contexts.js's own 5s client-side fetch timeout — a cost specific to
 * "never-seen-this-project-before", not representative of real usage (an
 * established project's table already exists). Without this, the hook's
 * fetch times out, falls into its catch branch, and emits a bare
 * {continue:true} regardless of whether the real file is good or bad —
 * which would make the "good file" test pass for the wrong reason (a
 * timeout and a genuine silent-success look identical) and the "bad file"
 * test fail even though the feature works correctly.
 */
async function warmProjectTable(projectDir: string, contextDir: string) {
  const warmupFile = path.join(contextDir, 'decision-warmup.md');
  fs.writeFileSync(
    warmupFile,
    '---\nname: warmup\ndescription: throwaway file to force table creation\nmetadata:\n  type: decision\n---\nbody'
  );
  await fetch(`${daemonUrl}/notify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file: warmupFile, cwd: projectDir })
  });
  fs.rmSync(warmupFile);
}

test('watch-contexts.js surfaces a non-blocking warning when the just-edited file has invalid YAML', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });
  await warmProjectTable(projectDir, contextDir);

  const badFile = path.join(contextDir, 'decisions', 'decision-bad.md');
  fs.writeFileSync(
    badFile,
    '---\nname: bad\ndescription: unquoted: colon breaks this\nmetadata:\n  type: decision\n---\nbody'
  );

  const r = runWatchContexts(badFile, projectDir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.parsed, `no JSON on stdout: ${r.stdout}`);
  // Never blocks, even when surfacing the warning.
  assert.equal(r.parsed!.continue, true);
  assert.match(String(r.parsed!.systemMessage), /invalid frontmatter YAML/);
  const hookOutput = r.parsed!.hookSpecificOutput as { additionalContext?: string } | undefined;
  assert.match(hookOutput?.additionalContext ?? '', /invalid frontmatter YAML/);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('watch-contexts.js stays silent (bare {continue:true}) for a file with valid YAML', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });
  await warmProjectTable(projectDir, contextDir);

  const goodFile = path.join(contextDir, 'decisions', 'decision-good.md');
  fs.writeFileSync(
    goodFile,
    '---\nname: good\ndescription: a perfectly fine description\nmetadata:\n  type: decision\n---\nbody'
  );

  const r = runWatchContexts(goodFile, projectDir);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.deepEqual(r.parsed, { continue: true });

  fs.rmSync(projectDir, { recursive: true, force: true });
});
