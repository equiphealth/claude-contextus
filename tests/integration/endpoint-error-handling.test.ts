/**
 * INTEGRATION — daemon endpoint error-handling and response shapes.
 *
 * Regression coverage for two bugs found live (2026-07-20/21, no test caught
 * either at the time):
 *
 * 1. `/capture` silently dropping requests when the daemon was busy embedding,
 *    returning `{continue: true}` (the hook-response shape) instead of an
 *    honest capture response (#32).
 * 2. `/capture` still falling through to that same `{continue: true}` shape
 *    for failures upstream of its own queue (e.g. a malformed JSON body),
 *    since it shared the generic dispatch catch-all with the hook-triggered
 *    endpoints (#33). `/capture` is never hook-triggered — there's no prompt
 *    it could be blocking — so it should never return `{continue: true}`.
 *
 * These tests boot the real `requestHandler` (extracted from daemon/server.ts
 * specifically so it's importable without booting the real daemon — see the
 * entrypoint guard around `startDaemon()`) on an ephemeral port and fire real
 * HTTP requests at it. Touches disk (writes real capture files under a
 * throwaway project dir) but loads NO embedding model — capture's embed step
 * is fire-and-forget with its own internal catch, so a missing/unreachable
 * Ollama in CI degrades to a logged warning, not a test failure.
 *
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Route HOME to a throwaway dir BEFORE importing the server module — several
// daemon internals (config, logs, runtime files) resolve paths off HOME at
// import/call time. Isolates this run from the real ~/.contextus/.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));
process.env.HOME = homeDir;

const { requestHandler } = await import('../../daemon/server.js');

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));

let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(requestHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

async function post(urlPath: string, body: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('/capture with malformed JSON never returns {continue: true} — gets an honest error instead', async () => {
  const { status, json } = await post('/capture', '{not valid json');
  assert.equal(json.continue, undefined, '/capture must never return the hook-response shape');
  assert.equal(json.ok, false);
  assert.match(json.error, /capture failed/i);
  assert.equal(status, 400);
});

test('/capture with a well-formed context payload succeeds and writes the file', async () => {
  const { status, json } = await post(
    '/capture',
    JSON.stringify({
      slug: 'itest-endpoint-check',
      description: 'temp file from endpoint-error-handling.test.ts',
      category: 'gotcha',
      body: 'test content',
      cwd: projectDir
    })
  );
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.target, 'context');
  assert.ok(fs.existsSync(json.file), 'capture file should exist on disk');
  assert.match(fs.readFileSync(json.file, 'utf-8'), /name: itest-endpoint-check/);
});

test('/capture with missing required fields returns 400 with a real error, not {continue: true}', async () => {
  const { status, json } = await post('/capture', JSON.stringify({ cwd: projectDir }));
  assert.equal(json.continue, undefined);
  assert.equal(status, 400);
  assert.match(json.error, /missing required fields/i);
});

test('/query with malformed JSON still degrades to {continue: true} — unchanged hook behavior', async () => {
  const { status, json } = await post('/query', '{not valid json');
  assert.equal(status, 200);
  assert.equal(json.continue, true, '/query must keep degrading gracefully — it can gate a prompt');
});

test('/notify with malformed JSON still degrades to {continue: true} — unchanged hook behavior', async () => {
  const { status, json } = await post('/notify', '{not valid json');
  assert.equal(status, 200);
  assert.equal(json.continue, true);
});

test('/reconcile with malformed JSON still degrades to {continue: true} — unchanged hook behavior', async () => {
  const { status, json } = await post('/reconcile', '{not valid json');
  assert.equal(status, 200);
  assert.equal(json.continue, true);
});

test('unknown route returns a real 404, not {continue: true}', async () => {
  const { status, json } = await post('/does-not-exist', '{}');
  assert.equal(status, 404);
  assert.equal(json.continue, undefined);
});
