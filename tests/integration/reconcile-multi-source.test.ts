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
 * The routing fix (#3) is tested by calling `determineSource()` directly
 * (now exported) rather than through the full `/notify` HTTP path: /notify
 * is hook-triggered, so it correctly degrades to `{continue: true}` on ANY
 * internal failure — including the embedding provider being unreachable,
 * which `embedSingleFile` hits unconditionally (it calls the real embedder,
 * with no environment-specific skip). That makes "did routing succeed"
 * unobservable from the HTTP response alone in a CI environment with no
 * Ollama/Transformers available. `determineSource` is a pure decision
 * function (config + path matching, no embedder/LanceDB I/O), so testing it
 * directly sidesteps that entirely.
 *
 * The /reconcile tests below DO boot the real `requestHandler` and hit real
 * LanceDB (check mode never calls the embedder, so no provider is needed).
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

const { requestHandler } = await import('../../daemon/server.js');

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

test('determineSource routes a docs/ file to the projectDocs source, not just .claude/context/', async () => {
  const { determineSource } = await import('../../daemon/server.js');
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const absFile = path.join(docsDir, 'GUIDE.md');
  fs.writeFileSync(absFile, '# A real doc\nsome content');

  // Before the fix, determineSource only matched .claude/context/-shaped
  // paths and this would return null (routed nowhere).
  const result = determineSource(absFile, projectDir, undefined);

  assert.ok(result, 'docs/ must resolve to a real source, not null');
  assert.equal(result!.sourceName, 'projectDocs');
  assert.equal(result!.sourceDir, docsDir);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('determineSource still returns null for a file outside every configured source', async () => {
  const { determineSource } = await import('../../daemon/server.js');
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  const absFile = path.join(projectDir, 'src', 'notes.md');
  fs.writeFileSync(absFile, '# unrelated notes');

  const result = determineSource(absFile, projectDir, undefined);

  assert.equal(result, null);

  fs.rmSync(projectDir, { recursive: true, force: true });
});
