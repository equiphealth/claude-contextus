import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertTableMetaCompatible, writeTableMeta } from '../lib/storage/lance-client.js';

test('rejects a project embedding configuration that conflicts with shared corpus metadata', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-meta-'));
  const previous = process.env.HOME;
  process.env.HOME = home;
  try {
    fs.mkdirSync(path.join(home, '.contextus', 'data'), { recursive: true });
    writeTableMeta({
      provider: 'transformers',
      embeddingModel: 'global-model',
      dimensions: 768,
      createdAt: new Date().toISOString()
    });
    assert.throws(
      () => assertTableMetaCompatible({ provider: 'transformers', model: 'project-model' }, 7),
      /Embedding configuration conflicts/
    );
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
