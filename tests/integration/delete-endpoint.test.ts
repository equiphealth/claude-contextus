/**
 * INTEGRATION — POST /delete (archive-not-destroy context files).
 *
 * `/delete` moves a context file to `.claude/context/.archive/` (flat, no
 * category subdir — matches /context-archive's existing documented layout),
 * removes its CONTEXT.md index entry, and drops its LanceDB rows if any
 * exist. Never a hard delete: the file is one `mv` away from being restored.
 *
 * Same reasoning as /capture (#33): /delete is never hook-triggered, so it
 * must never return `{continue: true}` on failure — every path gets an
 * honest `{ok: false, error}` instead.
 *
 * These tests boot the real `requestHandler` on an ephemeral port — no
 * embedding model is loaded, so `embeddingsRemoved` is always `false` here
 * (no LanceDB table exists for the throwaway project); that's the correct,
 * honest answer, not a test gap — a real project with a populated table
 * would see `embeddingsRemoved: true`.
 *
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after, beforeEach } from 'node:test';
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

let projectDir: string;
let contextDir: string;

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
});

// Fresh project dir per test — /delete mutates the filesystem (moves files),
// so tests can't share state.
beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'gotchas'), { recursive: true });
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

function seedContextFile(relPath: string, opts: { indexed?: boolean } = {}): string {
  const abs = path.join(contextDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `---\nname: itest-file\ndescription: seeded for delete-endpoint.test.ts\nmetadata:\n  type: gotcha\n---\n\nbody\n`
  );
  if (opts.indexed !== false) {
    const indexFile = path.join(contextDir, 'CONTEXT.md');
    fs.appendFileSync(indexFile, `- [itest-file](${relPath}) — seeded for test\n`);
  }
  return abs;
}

test('/delete archives an existing file — moved, index entry removed', async () => {
  seedContextFile('gotchas/gotcha-itest-file.md');

  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: 'gotchas/gotcha-itest-file.md', cwd: projectDir })
  );

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.removedFromIndex, true);
  assert.equal(json.archivedRelPath, '.archive/gotcha-itest-file.md');

  assert.ok(
    !fs.existsSync(path.join(contextDir, 'gotchas/gotcha-itest-file.md')),
    'original file should be gone'
  );
  assert.ok(fs.existsSync(json.archived), 'archived file should exist at reported path');
  assert.equal(path.dirname(json.archived), path.join(contextDir, '.archive'));

  const indexContent = fs.readFileSync(path.join(contextDir, 'CONTEXT.md'), 'utf-8');
  assert.ok(!indexContent.includes('gotcha-itest-file.md'), 'index line should be gone');
});

test('/delete on a file with no CONTEXT.md index entry still archives cleanly', async () => {
  seedContextFile('gotchas/gotcha-unindexed.md', { indexed: false });

  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: 'gotchas/gotcha-unindexed.md', cwd: projectDir })
  );

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.removedFromIndex, false, 'nothing to remove — no index file existed');
});

test('/delete on a nonexistent file returns 404, not {continue: true}', async () => {
  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: 'gotchas/gotcha-does-not-exist.md', cwd: projectDir })
  );
  assert.equal(status, 404);
  assert.equal(json.ok, false);
  assert.equal(json.continue, undefined);
});

test('/delete blocks path traversal outside the context dir', async () => {
  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: '../../../../etc/passwd', cwd: projectDir })
  );
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.error, /escapes the context directory/i);
});

test('/delete with missing relPath returns 400', async () => {
  const { status, json } = await post('/delete', JSON.stringify({ cwd: projectDir }));
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.error, /missing required field/i);
});

test('/delete with missing cwd (project scope) returns 400', async () => {
  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: 'gotchas/gotcha-itest-file.md' })
  );
  assert.equal(status, 400);
  assert.equal(json.ok, false);
  assert.match(json.error, /cwd is required/i);
});

test('/delete with malformed JSON never returns {continue: true} — honest error instead', async () => {
  const { status, json } = await post('/delete', '{not valid json');
  assert.equal(json.continue, undefined, '/delete must never return the hook-response shape');
  assert.equal(json.ok, false);
  assert.match(json.error, /delete failed/i);
  assert.equal(status, 400);
});

test('archived files are excluded from re-embedding by default source config', async () => {
  const { loadProjectConfig, projectHash } = await import('../../lib/config.js');
  const cfg = loadProjectConfig(projectHash(projectDir), projectDir);
  assert.ok(
    cfg.sources.projectContext.exclude?.some((g) => g.includes('.archive')),
    'projectContext exclude patterns should cover .archive/**'
  );
});
