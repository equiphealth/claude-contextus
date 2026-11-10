import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ContextRow } from '../../lib/storage/lance-client.js';

test('concurrent cold-start writes cannot mix embedding models', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-race-'));
  const oldHome = process.env.HOME;
  process.env.HOME = home;
  const { upsertRows, getContentHashes, readTableMeta, resetConnection } = await import('../../lib/storage/lance-client.js');
  const row = (id: string): ContextRow => ({
    id, project: 'project', vector: [1, 0], document: id, filename: id,
    chunk_index: 0, heading: '', type: 'reference', source: 'projectDocs', tags: '',
    hit_count: 0, last_hit: '', updated_at: '', content_hash: id
  });
  try {
    const results = await Promise.allSettled([
      upsertRows([row('first')], undefined, { provider: 'transformers', model: 'first' }),
      upsertRows([row('second')], undefined, { provider: 'transformers', model: 'second' })
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(readTableMeta()?.embeddingModel, 'first');
    const hashes = await getContentHashes(undefined, 'projectDocs', 'project');
    assert.equal(hashes.has('first'), true);
    assert.equal(hashes.has('second'), false);
  } finally {
    resetConnection();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
