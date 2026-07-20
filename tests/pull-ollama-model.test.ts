/**
 * Tests for Ollama model pulling utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { OLLAMA_MODELS } from '../scripts/pull-ollama-model.js';

describe('OLLAMA_MODELS', () => {
  it('has three model options', () => {
    assert.equal(OLLAMA_MODELS.length, 3);
  });

  it('has exactly one default model', () => {
    const defaults = OLLAMA_MODELS.filter((m) => m.default);
    assert.equal(defaults.length, 1);
  });

  it('has nomic-embed-text as default', () => {
    const defaultModel = OLLAMA_MODELS.find((m) => m.default);
    assert.equal(defaultModel?.name, 'nomic-embed-text');
  });

  it('includes model size and description', () => {
    for (const model of OLLAMA_MODELS) {
      assert.ok(model.name);
      assert.ok(model.size);
      assert.ok(model.description);
      assert.ok(typeof model.default === 'boolean');
    }
  });

  it('has valid model names', () => {
    const names = OLLAMA_MODELS.map((m) => m.name);
    assert.ok(names.includes('nomic-embed-text'));
    assert.ok(names.includes('mxbai-embed-large'));
    assert.ok(names.includes('all-minilm'));
  });

  it('has size information matching expected patterns', () => {
    for (const model of OLLAMA_MODELS) {
      assert.match(model.size, /^\d+MB$/);
    }
  });
});
