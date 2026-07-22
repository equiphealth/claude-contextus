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

test('/delete only removes its own entry from CONTEXT.md, leaving siblings intact', async () => {
  seedContextFile('gotchas/gotcha-1.md');
  seedContextFile('gotchas/gotcha-2.md'); // target
  seedContextFile('gotchas/gotcha-3.md');
  // seedContextFile appends one CONTEXT.md line per call under a shared `name:
  // itest-file` — override each entry's slug in the index so the three lines
  // are distinguishable (otherwise the marker match can't tell 1/2/3 apart).
  const indexFile = path.join(contextDir, 'CONTEXT.md');
  fs.writeFileSync(
    indexFile,
    [
      '- [itest-1](gotchas/gotcha-1.md) — seeded for test',
      '- [itest-2](gotchas/gotcha-2.md) — seeded for test',
      '- [itest-3](gotchas/gotcha-3.md) — seeded for test',
      ''
    ].join('\n')
  );

  const { status, json } = await post(
    '/delete',
    JSON.stringify({ relPath: 'gotchas/gotcha-2.md', cwd: projectDir })
  );

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.removedFromIndex, true);

  const indexContent = fs.readFileSync(indexFile, 'utf-8');
  assert.ok(indexContent.includes('gotcha-1.md'), 'sibling entry 1 should remain');
  assert.ok(indexContent.includes('gotcha-3.md'), 'sibling entry 3 should remain');
  assert.ok(!indexContent.includes('gotcha-2.md'), 'target entry should be removed');
});

test('/delete works for user-scoped context (~/.contextus/context, no cwd needed)', async () => {
  // HOME is already routed to a throwaway dir at module load (see top of file),
  // so this writes/reads under that sandbox, never the real ~/.contextus/context.
  const userContextDir = path.join(process.env.HOME!, '.contextus', 'context');
  const relPath = 'gotchas/gotcha-user-level.md';
  const absPath = path.join(userContextDir, relPath);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, 'user level doc');

  const { status, json } = await post('/delete', JSON.stringify({ relPath, scope: 'user' }));

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok(
    fs.existsSync(path.join(userContextDir, '.archive', 'gotcha-user-level.md')),
    'file should be archived under the user-scoped context dir, not the project one'
  );
  assert.ok(!fs.existsSync(absPath), 'original user-scoped file should be gone');
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

test('/delete returns embeddingsRemoved: true against a real LanceDB row (no mocking)', async () => {
  // No embedding model is loaded in this suite, so we can't get here via a real
  // /capture + async embed. Instead, insert a row directly into the real,
  // file-based LanceDB table (unified DB, resolved under the throwaway HOME set
  // at the top of this file) — same table shape /delete's own getContentHashes
  // and deleteByFilename calls query against. This exercises the actual LanceDB
  // predicate logic instead of asserting against a mock's call arguments.
  const relPath = 'gotchas/gotcha-real-lancedb.md';
  seedContextFile(relPath);

  const { projectHash } = await import('../../lib/config.js');
  const { createTable, tableExists, openTable } = await import('../../lib/storage/lance-client.js');
  const projectId = projectHash(projectDir);

  // Full ContextRow shape — LanceDB infers its schema from the first insert, so
  // a partial row (e.g. just filename/vector) would create a table too narrow
  // for getContentHashes' own .select(['filename','content_hash','source','project']).
  const row = {
    id: `${projectId}:${relPath}:0`,
    project: projectId,
    vector: Array(8).fill(0), // dimension is irrelevant here — no search/query, only a delete predicate
    document: 'dummy content for test',
    filename: relPath,
    chunk_index: 0,
    heading: '',
    type: 'gotcha',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: new Date().toISOString(),
    content_hash: 'dummy-hash-for-test'
  };

  if (await tableExists()) {
    const table = await openTable();
    await table.add([row]);
  } else {
    await createTable([row], {
      providerInfo: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        ollamaModel: 'nomic-embed-text'
      }
    });
  }

  const { status, json } = await post('/delete', JSON.stringify({ relPath, cwd: projectDir }));

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(
    json.embeddingsRemoved,
    true,
    'a real row existed for this file+project and should have been found and deleted'
  );
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
