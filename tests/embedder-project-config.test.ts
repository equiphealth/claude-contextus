import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertEmbeddingDimensions,
  embedDocument,
  embedDocuments,
  snapshotEmbeddingContext,
  resetEmbedder
} from '../lib/embedding/embedder.js';
import { loadConfig, projectLocalConfigPath, resetConfigCache } from '../lib/config.js';

test('project-level embedding dimensions are rejected', async () => {
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

    await assert.rejects(
      () => embedDocument('project-specific embedding', { projectId, cwd }),
      /cannot override embedding settings: dimensions/
    );
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

test('project snapshots cannot change the shared embedding space', async () => {
  const previousFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
  const globalDimensions = loadConfig().embedding.dimensions;
  const context = snapshotEmbeddingContext();
  context.config.embedding.provider = 'ollama';
  context.config.embedding.model = 'project-model';
  context.config.embedding.ollamaModel = 'project-ollama-model';
  context.config.embedding.dimensions = 3;
  try {
    const vectors = await embedDocuments(['project embedding'], undefined, context);
    assert.deepEqual(
      vectors.map((vector) => vector.length),
      [globalDimensions]
    );
  } finally {
    if (previousFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = previousFake;
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
