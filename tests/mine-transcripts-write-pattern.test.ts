/**
 * writePattern's infraFailure signal — the piece that fixes the "watermark
 * advances even when the whole run failed" bug (#1/#2 from the independent
 * review of PR #40, GH issue #39). `mineProject` uses this signal to decide
 * whether a session file is safe to consider "processed" for watermark
 * purposes: an infra failure (daemon unreachable) must NOT count as
 * processed, while a dedup skip or a content-level rejection (daemon
 * reachable, just said no) is a normal, expected outcome that should.
 *
 * Uses a real ephemeral HTTP server (not a mock) for the "daemon reachable
 * but rejects" case, and a genuinely unreachable port for the "daemon down"
 * case — both exercise the real fetch/catch path in writePattern, not an
 * assumption about it.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { writePattern } from '../scripts/mine-transcripts.js';
import { clearDaemonURLCache } from '../lib/daemon-url.js';
import type { ExtractedPattern } from '../lib/transcript/extractor.js';

function fakePattern(
  slug = 'test-pattern',
  scope: 'project' | 'user' = 'project'
): ExtractedPattern {
  return {
    slug,
    category: 'gotcha',
    description: 'a fake pattern for testing',
    body: 'body content',
    confidence: 0.9,
    scope,
    sourceTurns: [0]
  };
}

after(() => {
  clearDaemonURLCache();
  delete process.env.CONTEXTUS_DAEMON_URL;
});

test('writePattern: dry-run always reports written:true, infraFailure:false (no network call)', async () => {
  // Point at a guaranteed-unreachable port to prove dry-run never even tries
  // to reach it — if it did, this would come back as an infra failure instead.
  process.env.CONTEXTUS_DAEMON_URL = 'http://127.0.0.1:1';
  clearDaemonURLCache();
  const result = await writePattern(fakePattern(), '/fake/project', true);
  assert.deepEqual(result, { written: true, infraFailure: false });
});

test('writePattern: daemon unreachable (connection refused) → infraFailure:true, written:false', async () => {
  // Port 1 is a privileged, essentially-guaranteed-nothing-listens-there port
  // — the fetch will throw (ECONNREFUSED or similar), exercising the real
  // catch block, not a mocked one.
  process.env.CONTEXTUS_DAEMON_URL = 'http://127.0.0.1:1';
  clearDaemonURLCache();
  const result = await writePattern(fakePattern(), '/fake/project', false);
  assert.equal(result.written, false);
  assert.equal(
    result.infraFailure,
    true,
    'an unreachable daemon must be flagged as an infra failure'
  );
});

test('writePattern: daemon reachable but rejects the request (non-2xx) → infraFailure:false', async () => {
  // A real server that's UP but says no — this is a content/validation
  // problem, not "the daemon is down". Must not block watermark advancement.
  const server = http.createServer((_req, res) => {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'bad request' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.CONTEXTUS_DAEMON_URL = `http://127.0.0.1:${port}`;
  clearDaemonURLCache();

  try {
    const result = await writePattern(fakePattern(), '/fake/project', false);
    assert.equal(result.written, false);
    assert.equal(
      result.infraFailure,
      false,
      'a reachable daemon rejecting the request is not an infra failure'
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('writePattern: daemon reachable, /capture succeeds → written:true, infraFailure:false', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/query') {
      // isDuplicate's check — report no overlap so writePattern proceeds.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ continue: true }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, file: 'gotchas/gotcha-test-pattern.md' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.CONTEXTUS_DAEMON_URL = `http://127.0.0.1:${port}`;
  clearDaemonURLCache();

  try {
    const result = await writePattern(fakePattern(), '/fake/project', false);
    assert.deepEqual(result, { written: true, infraFailure: false });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("writePattern: forwards the pattern's own scope to /capture, not a hardcoded value", async () => {
  // Regression (independent review of PR #40 dry-run finding): writePattern
  // used to send scope:'project' unconditionally, so a pattern the extraction
  // LLM correctly classified as scope:'user' (a cross-project tool/skill
  // insight) still landed in this project's corpus. Captures the actual
  // request body /capture receives to prove the field is forwarded, not just
  // that the call succeeds.
  const capturedBodies: Array<Record<string, unknown>> = [];
  const server = http.createServer((req, res) => {
    if (req.url === '/query') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ continue: true }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      capturedBodies.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, file: 'ignored.md' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  process.env.CONTEXTUS_DAEMON_URL = `http://127.0.0.1:${port}`;
  clearDaemonURLCache();

  try {
    await writePattern(fakePattern('user-scoped-pattern', 'user'), '/fake/project', false);
    await writePattern(fakePattern('project-scoped-pattern', 'project'), '/fake/project', false);
    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[0].scope, 'user');
    assert.equal(capturedBodies[1].scope, 'project');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
