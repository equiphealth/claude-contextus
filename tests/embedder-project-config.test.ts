import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertEmbeddingDimensions,
  embedDocument,
  resetEmbedder
} from '../lib/embedding/embedder.js';
import { projectLocalConfigPath, resetConfigCache } from '../lib/config.js';

test('embedDocument resolves project-level embedding dimensions', async () => {
  const projectId = `embedder-project-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-embedder-'));
  const localConfig = projectLocalConfigPath(projectId);
  const previousFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;

  try {
    fs.mkdirSync(path.dirname(localConfig), { recursive: true });
    fs.writeFileSync(localConfig, JSON.stringify({ config: { embedding: { dimensions: 7 } } }));
    process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
    resetConfigCache();
    resetEmbedder();

    const vector = await embedDocument('project-specific embedding', { projectId, cwd });
    assert.equal(vector.length, 7);
  } finally {
    if (previousFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = previousFake;
    if (fs.existsSync(localConfig))
      fs.rmSync(path.dirname(localConfig), { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    resetConfigCache();
    resetEmbedder();
  }
});

test('assertEmbeddingDimensions rejects provider vectors outside the configured size', () => {
  assertEmbeddingDimensions(
    [
      [0, 0],
      [1, 1]
    ],
    2
  );
  assert.throws(
    () =>
      assertEmbeddingDimensions(
        [
          [0, 0],
          [1, 1, 1]
        ],
        2
      ),
    /3; expected 2/
  );
});
