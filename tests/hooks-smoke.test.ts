/**
 * Hook smoke tests — execute each hook FILE the way the harness does (pipe a
 * payload to stdin, run `node scripts/<hook>.js`), not just import its functions.
 *
 * Why this exists (hook-files-esm-and-smoke-test memory): a hook entry point can
 * be broken in ways unit-testing its inner functions never exercises — a
 * `require` in an ESM repo throws only when the file is LOADED as the runtime
 * loads it. The Phase-5 Stop hook shipped green unit tests and still crashed on
 * its first real fire for exactly this reason. So here we load the actual file.
 *
 * These run with the daemon DOWN, exercising the graceful-degradation path: every
 * hook must load cleanly, exit 0, and emit a valid `{ continue: true }` (the
 * UserPromptSubmit/SessionStart/PostToolUse contract) or `{}` — never hang, never
 * throw a module-load error. No model load, no network dependency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, '..', 'scripts');

/** Run a hook file with a stdin payload; return {status, stdout, parsed}. */
function runHook(file: string, payload: unknown, extraEnv?: Record<string, string>) {
  const res = spawnSync('node', [path.join(SCRIPTS, file)], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15_000,
    // Point at a non-listening port so the daemon is "down" and hooks take the
    // graceful-degradation branch instead of doing real work.
    // silent verbosity → no systemMessage noise; tiny warm bounds so the
    // session-start spawn path doesn't poll a cold daemon for 15s.
    env: {
      ...process.env,
      CONTEXTUS_VERBOSITY: 'silent',
      CONTEXTUS_WARM_ATTEMPTS: '1',
      CONTEXTUS_WARM_INTERVAL_MS: '50',
      ...extraEnv
    }
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = res.stdout.trim() ? JSON.parse(res.stdout.trim()) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, stdout: res.stdout, parsed, stderr: res.stderr };
}

test('query-hook.js: loads, exits 0, emits {continue:true} (daemon down)', () => {
  const r = runHook('query-hook.js', { prompt: 'how does X work', cwd: process.cwd() });
  assert.equal(r.status, 0, `nonzero exit; stderr: ${r.stderr}`);
  assert.ok(r.parsed, `no JSON on stdout: ${r.stdout}`);
  assert.equal(r.parsed!.continue, true);
});

test('query-hook.js: empty prompt → clean continue, no crash', () => {
  const r = runHook('query-hook.js', { prompt: '', cwd: process.cwd() });
  assert.equal(r.status, 0);
  assert.equal(r.parsed!.continue, true);
});

test('awareness-hook.js: loads, exits 0, emits valid JSON', () => {
  const r = runHook('awareness-hook.js', { prompt: 'a real prompt', cwd: process.cwd() });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.parsed, `no JSON on stdout: ${r.stdout}`);
  // continue is always true; an additionalContext footer is optional.
  assert.equal(r.parsed!.continue, true);
});

test('watch-contexts.js: a non-context edit → clean continue', () => {
  const r = runHook('watch-contexts.js', {
    tool_input: { file_path: '/tmp/somewhere/else.ts' },
    cwd: process.cwd()
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.equal(r.parsed!.continue, true);
});

test('stop-evaluation.js: no active campaign → loads, exits 0 (the ESM-regression guard)', () => {
  // This is the hook that shipped a `require` in an ESM repo and crashed live.
  // Executing the FILE (not importing its functions) is the whole point.
  const r = runHook('stop-evaluation.js', {
    transcript_path: '/nonexistent/transcript.jsonl',
    cwd: process.cwd()
  });
  assert.equal(r.status, 0, `stop hook crashed on load; stderr: ${r.stderr}`);
  // It may emit {} or {continue:true}; either is a clean non-blocking result.
  assert.ok(r.parsed !== null || r.stdout.trim() === '', `unexpected stdout: ${r.stdout}`);
});

test('session-start-hook.js: silent verbosity → loads, exits 0, continues', () => {
  const r = runHook(
    'session-start-hook.js',
    { cwd: process.cwd() },
    { CONTEXTUS_TEST_MODE: '1', CONTEXTUS_VERBOSITY: 'silent' }
  );
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  assert.ok(r.parsed, `no JSON on stdout: ${r.stdout}`);
  assert.equal(r.parsed!.continue, true);
  // Test mode + silent verbosity → no systemMessage
  assert.equal(r.parsed!.systemMessage, undefined, 'test mode must not emit a systemMessage');
});
