/**
 * INTEGRATION — getContentHashes source filtering (real LanceDB table).
 *
 * Regression for the reconcile-check bug (2026-06-15): the daemon's /reconcile
 * `check` called getContentHashes(project) WITHOUT the source filter, so doc/user-
 * pack rows looked like orphans of the `.claude/context/` dir → state 'stale',
 * removeCount=34, a nonsense "re-embedding 0" message, and a background reconcile
 * that would have deleted 34 doc/user chunks every session-start. The fix scopes
 * the call to 'projectContext' (matching runReconcile); this test pins the
 * filtering contract that fix depends on.
 *
 * Touches disk (LanceDB) but loads NO embedding model — vectors are handcrafted.
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
// Type-only import is erased at runtime (no DB load from this line).
import type { ContextRow } from '../../lib/storage/lance-client.js';

// Route the DB to a throwaway HOME BEFORE importing the client (resolveDBPath
// expands ~ at call time, so this must be set first).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-'));
process.env.HOME = tmp;

const { createTable, getContentHashes, resetConnection } =
  await import('../../lib/storage/lance-client.js');

const PROJECT = 'itest';
const DIM = 768;
function vec(seed: number): number[] {
  return Array.from({ length: DIM }, (_, i) => Math.sin(seed * 0.1 + i * 0.01));
}

function row(id: string, filename: string, source: string): ContextRow {
  return {
    id,
    project: PROJECT,
    vector: vec(id.length),
    document: `doc for ${id}`,
    filename,
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source,
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '2026-06-15T00:00:00.000Z',
    content_hash: `hash-${id}`
  };
}

before(async () => {
  // A mixed-source corpus: 2 projectContext files + 2 projectDocs + 1 userMemory.
  await createTable(
    [
      row('decisions/decision-a.md#0', 'decisions/decision-a.md', 'projectContext'),
      row('reference/reference-b.md#0', 'reference/reference-b.md', 'projectContext'),
      row('projectDocs:DESIGN.md#0', 'DESIGN.md', 'projectDocs'),
      row('projectDocs:LOGGING.md#0', 'LOGGING.md', 'projectDocs'),
      row('userMemory:notes.md#0', 'notes.md', 'userMemory')
    ],
    { projectName: PROJECT, replace: true }
  );
});

after(() => {
  resetConnection();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('unfiltered → every source filename (the buggy call path)', async () => {
  const all = await getContentHashes(PROJECT);
  assert.equal(all.size, 5, 'all five files across all sources');
  assert.ok(all.has('DESIGN.md'), 'doc file present when unfiltered');
});

test("filtered to 'projectContext' → ONLY context files (the fix)", async () => {
  const ctx = await getContentHashes(PROJECT, 'projectContext');
  assert.equal(ctx.size, 2, 'only the two projectContext files');
  assert.ok(ctx.has('decisions/decision-a.md'));
  assert.ok(ctx.has('reference/reference-b.md'));
  assert.ok(!ctx.has('DESIGN.md'), 'doc rows must NOT leak in (the orphan-bug source)');
  assert.ok(!ctx.has('notes.md'), 'userMemory rows must NOT leak in');
});

test('hashes are keyed by filename, one entry per file', async () => {
  const ctx = await getContentHashes(PROJECT, 'projectContext');
  assert.equal(ctx.get('decisions/decision-a.md'), 'hash-decisions/decision-a.md#0');
});
