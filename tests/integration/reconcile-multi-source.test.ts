/**
 * INTEGRATION — /reconcile and /notify across ALL enabled sources, not just
 * projectContext (GH issue #22).
 *
 * Three bugs fixed together here, all from the same root cause (daemon code
 * paths that only knew about `.claude/context/` even though the config always
 * listed `docs/` as a real, enabled `projectDocs` source):
 *
 * 1. `/reconcile {check: true}` only ever inspected projectContext, so a
 *    project whose ONLY drift was under `docs/` reported `state: 'fresh'`
 *    (wrong) — and since session-start's checkCorpus() gates the REAL
 *    reconcile (which is what arms the live fs.watch per source) on this
 *    check, docs/ never got watched that session either.
 * 2. `runReconcile` (used by both check-mode's twin and the real reconcile)
 *    excluded only CONTEXT.md/README.md, never DOCS.md — so reconciling the
 *    projectDocs source would count/embed DOCS.md itself as real document
 *    content.
 * 3. `/notify`'s `determineSource()` only matched `.claude/context/`-shaped
 *    paths (mirrored in `scripts/watch-contexts.js`'s old `isContextFile`),
 *    so an edit under `docs/` never triggered a re-embed at all.
 *
 * Boots the real `requestHandler` on an ephemeral port, no embedding model
 * loaded (reconcile's check mode never calls the embedder; /notify's
 * embedSingleFile failing to embed is caught internally and doesn't fail
 * the request — see embed-file.ts).
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

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));
process.env.HOME = homeDir;

const { requestHandler, closeAllWatchers } = await import('../../daemon/server.js');

let projectDir: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(requestHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  // The "/notify routes a docs/ file..." test below is a real success path
  // through determineSource → watchContextDir, which arms a live fs.watch on
  // projectDir/docs (deleted right after by that test). Without closing it,
  // the open handle keeps this process's event loop non-empty — node --test
  // then hangs waiting for a natural exit instead of finishing (GH issue #22).
  closeAllWatchers();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(homeDir, { recursive: true, force: true });
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

test('/reconcile {check:true} counts a NEW projectDocs file, not just projectContext', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  // A real context file AND a real doc file — both "new" (no table exists yet).
  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-foo.md'),
    '---\nname: foo\nmetadata:\n  type: decision\n---\nbody'
  );
  fs.writeFileSync(path.join(docsDir, 'GUIDE.md'), '# A real doc\nsome content');
  // The doc source's own index file — must NEVER be counted as a "new" doc.
  fs.writeFileSync(path.join(docsDir, 'DOCS.md'), '# Docs Index\n- GUIDE.md');

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  // No table exists yet for this project → 'missing' takes priority over any
  // per-source 'stale'/'fresh' — this is the aggregated state across sources.
  assert.equal(json.state, 'missing');
  // 1 context file + 1 real doc file = 2. If DOCS.md leaked in, this would be 3.
  assert.equal(json.newCount, 2, 'DOCS.md must not count as a new document');

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} reports state:fresh when nothing changed across any source', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  // No files under either source dir at all — diskFiles.length === 0 → 'empty'
  // for every source, so the aggregate must also be 'empty', not 'missing'.

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(json.state, 'empty');
  assert.equal(json.newCount, 0);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/notify routes a docs/ file to the projectDocs source, not just .claude/context/', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, 'GUIDE.md'), '# A real doc\nsome content');

  // embedSingleFile (what /notify calls downstream) upserts via mergeInsert,
  // which requires the table to already exist — by design, /notify is the
  // INCREMENTAL path; cold-start table creation is reconcile's job. Seed a
  // throwaway row first so this test exercises routing, not that separate,
  // pre-existing "no table yet" constraint (unrelated to GH issue #22 —
  // reproduces identically for a .claude/context/ file on a fresh project).
  //
  // lance-client's LanceDB connection is a MODULE-LEVEL singleton shared by
  // every test file in this `node --test` process (see `_conn` in
  // lib/storage/lance-client.ts) — other integration files delete their own
  // tmp HOME in `after()` without resetting it. Under Node's default
  // cross-file concurrency, an unconditional createTable() here can race
  // against that and hit a connection left pointing at an already-deleted
  // directory. Check-then-add-or-create (same defensive pattern used in
  // delete-endpoint.test.ts's real-LanceDB-row test) avoids assuming which
  // state the shared connection is in.
  const { createTable, tableExists, openTable } = await import('../../lib/storage/lance-client.js');
  const { projectHash } = await import('../../lib/config.js');
  const projectId = projectHash(projectDir);
  const seedRow = {
    id: `${projectId}:seed.md:0`,
    project: projectId,
    vector: Array(8).fill(0),
    document: 'seed row so the table exists',
    filename: 'seed.md',
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: new Date().toISOString(),
    content_hash: 'seed-hash'
  };
  if (await tableExists()) {
    const table = await openTable();
    await table.add([seedRow]);
  } else {
    await createTable([seedRow], {
      providerInfo: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        ollamaModel: 'nomic-embed-text'
      }
    });
  }

  const { status, json } = await post(
    '/notify',
    JSON.stringify({ file: path.join(docsDir, 'GUIDE.md'), cwd: projectDir })
  );

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  // Before the fix, determineSource only matched .claude/context/-shaped
  // paths and this would report reason: 'not_in_any_source', embedded: false.
  assert.notEqual(json.reason, 'not_in_any_source', 'docs/ must resolve to a real source');

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/notify still returns not_in_any_source for a file outside every configured source', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'src', 'notes.md'), '# unrelated notes');

  const { status, json } = await post(
    '/notify',
    JSON.stringify({ file: path.join(projectDir, 'src', 'notes.md'), cwd: projectDir })
  );

  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.embedded, false);
  assert.equal(json.reason, 'not_in_any_source');

  fs.rmSync(projectDir, { recursive: true, force: true });
});
