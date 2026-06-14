/**
 * Config-write tests — the shared --diff/--apply plumbing /context-calibrate uses
 * to write retrieval knobs into plugin.json. Uses a temp file (the functions take
 * an explicit pluginPath) so the real plugin.json is never touched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  readConfigValue,
  buildChanges,
  renderDiff,
  hasRealChanges,
  applyChanges,
} from '../lib/calibration/config-write.js';

function tempPlugin(config: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cfg-'));
  const file = path.join(dir, 'plugin.json');
  fs.writeFileSync(file, JSON.stringify({ name: 'x', config }, null, 2));
  return file;
}

test('readConfigValue: resolves a dotted path', () => {
  const file = tempPlugin({ retrieval: { injectionFloor: 0.35, topK: 5 } });
  assert.equal(readConfigValue('retrieval.injectionFloor', file), 0.35);
  assert.equal(readConfigValue('retrieval.topK', file), 5);
  assert.equal(readConfigValue('retrieval.missing', file), undefined);
});

test('buildChanges: pairs current with proposed', () => {
  const file = tempPlugin({ retrieval: { injectionFloor: 0.35 } });
  const changes = buildChanges({ 'retrieval.injectionFloor': 0.49 }, file);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].current, 0.35);
  assert.equal(changes[0].proposed, 0.49);
});

test('hasRealChanges: false when proposed equals current', () => {
  const file = tempPlugin({ retrieval: { injectionFloor: 0.49 } });
  const same = buildChanges({ 'retrieval.injectionFloor': 0.49 }, file);
  assert.equal(hasRealChanges(same), false);
  const diff = buildChanges({ 'retrieval.injectionFloor': 0.5 }, file);
  assert.equal(hasRealChanges(diff), true);
});

test('renderDiff: shows -/+ only for real changes', () => {
  const file = tempPlugin({ retrieval: { injectionFloor: 0.35 } });
  const changes = buildChanges({ 'retrieval.injectionFloor': 0.49 }, file);
  const out = renderDiff(changes);
  assert.match(out, /retrieval\.injectionFloor/);
  assert.match(out, /- 0\.35/);
  assert.match(out, /\+ 0\.49/);
});

test('applyChanges: writes the value and preserves the rest of the file', () => {
  const file = tempPlugin({
    retrieval: { injectionFloor: 0.35, topK: 5, _note: 'keep me' },
    embedding: { provider: 'ollama' },
  });
  const written = applyChanges(buildChanges({ 'retrieval.injectionFloor': 0.49 }, file), file);
  assert.equal(written, 1);
  const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(reloaded.config.retrieval.injectionFloor, 0.49);
  assert.equal(reloaded.config.retrieval.topK, 5, 'sibling preserved');
  assert.equal(reloaded.config.retrieval._note, 'keep me', 'annotation preserved');
  assert.equal(reloaded.config.embedding.provider, 'ollama', 'other section preserved');
});

test('applyChanges: a no-op change writes nothing', () => {
  const file = tempPlugin({ retrieval: { injectionFloor: 0.49 } });
  const before = fs.readFileSync(file, 'utf8');
  const written = applyChanges(buildChanges({ 'retrieval.injectionFloor': 0.49 }, file), file);
  assert.equal(written, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'file untouched on no-op');
});

test('applyChanges: creates a missing nested key path', () => {
  const file = tempPlugin({ retrieval: { topK: 5 } });
  applyChanges(buildChanges({ 'retrieval.injectionFloor': 0.42 }, file), file);
  const reloaded = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(reloaded.config.retrieval.injectionFloor, 0.42);
});
