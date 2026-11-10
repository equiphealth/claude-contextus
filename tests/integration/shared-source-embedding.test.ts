import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('shared sources use shared embedding settings and the shared row scope', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-shared-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-project-'));
  const oldHome = process.env.HOME;
  const oldFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  process.env.HOME = home;
  process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
  const { resetConfigCache, loadConfig } = await import('../../lib/config.js');
  const { runReconcile } = await import('../../lib/embedding/reconcile-run.js');
  const { getContentHashes, readTableMeta, resetConnection } = await import('../../lib/storage/lance-client.js');
  try {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude', 'contextus.jsonc'), JSON.stringify({ embedding: { dimensions: 7 } }));
    const docs = path.join(home, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'guide.md'), '# Shared guide\ncontent');
    resetConfigCache();
    const dimensions = loadConfig().embedding.dimensions;
    const result = await runReconcile(docs, undefined, '', 'userDocs', undefined, 'doc', project);
    assert.equal(result.embedded, 1);
    assert.equal(readTableMeta()?.dimensions, dimensions);
    assert.equal((await getContentHashes(undefined, 'userDocs', '__user__')).has('guide.md'), true);
  } finally {
    resetConnection();
    resetConfigCache();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = oldFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
