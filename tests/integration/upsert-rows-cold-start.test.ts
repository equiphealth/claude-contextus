/**
 * INTEGRATION — upsertRows self-heals when no table exists yet (GH issue #22).
 *
 * `openTable` throws if the contextus table has never been created for a
 * project's DB. Before this fix, `upsertRows` called `openTable` unconditionally
 * — the single point where a project's FIRST-EVER incremental embed (via
 * /notify, before any /reconcile has ever run to bootstrap the table) crashed
 * uncaught. Found via a projectDocs /notify test that hit exactly this on a
 * brand-new project — reproduces identically for any source, not just docs.
 *
 * Touches disk (real LanceDB) but loads no embedding model — vectors are
 * handcrafted, same pattern as content-hashes-source-filter.test.ts.
 *
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextRow } from '../../lib/storage/lance-client.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-'));
process.env.HOME = tmp;

const { upsertRows, tableExists, getContentHashes, resetConnection } =
  await import('../../lib/storage/lance-client.js');

const PROJECT = 'upsert-cold-start-itest';
const DIM = 8;

function row(id: string, filename: string): ContextRow {
  return {
    id,
    project: PROJECT,
    vector: Array(DIM).fill(0),
    document: `doc for ${id}`,
    filename,
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectDocs',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '2026-08-08T00:00:00.000Z',
    content_hash: `hash-${id}`
  };
}

after(() => {
  resetConnection();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('upsertRows creates the table when none exists yet, instead of throwing', async () => {
  assert.equal(await tableExists(PROJECT), false, 'precondition: no table yet');

  // Before the fix, this threw ("Table 'contextus' was not found").
  await upsertRows([row('GUIDE.md#0', 'GUIDE.md')], PROJECT);

  assert.equal(await tableExists(PROJECT), true);
  const hashes = await getContentHashes(PROJECT, 'projectDocs', PROJECT);
  assert.equal(hashes.get('GUIDE.md'), 'hash-GUIDE.md#0');
});

test('upsertRows still updates existing rows once the table exists (unchanged behavior)', async () => {
  await upsertRows([row('GUIDE.md#0', 'GUIDE.md')], PROJECT);
  const updated: ContextRow = { ...row('GUIDE.md#0', 'GUIDE.md'), content_hash: 'hash-v2' };
  await upsertRows([updated], PROJECT);

  const hashes = await getContentHashes(PROJECT, 'projectDocs', PROJECT);
  assert.equal(hashes.get('GUIDE.md'), 'hash-v2', 'mergeInsert should update, not duplicate');
});
