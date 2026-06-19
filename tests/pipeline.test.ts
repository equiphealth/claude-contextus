import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processSearchResults, type PipelineConfig } from '../lib/retrieval/pipeline.js';
import type { SearchResult } from '../lib/storage/lance-client.js';

const DEFAULT_CONFIG: PipelineConfig = {
  topK: 5,
  injectionFloor: 0.725,
  maxTokens: 3000,
  provenanceFooter: false
};

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'test-pattern.md',
    vector: [],
    document: 'Some context about testing patterns.',
    filename: 'test-pattern.md',
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '2026-06-01T00:00:00Z',
    content_hash: 'abc123',
    distance: 0.5,
    similarity: 0.5,
    ...overrides
  };
}

// --- Near-miss scenario (the hard one to test before this extraction) ---

test('pipeline: near-miss when best score is between noise floor and injection floor', () => {
  const raw = [
    makeResult({
      id: 'daemon-lifecycle.md',
      filename: 'daemon-lifecycle.md',
      similarity: 0.68,
      distance: 0.32
    }),
    makeResult({
      id: 'config-reload.md',
      filename: 'config-reload.md',
      similarity: 0.65,
      distance: 0.35
    })
  ];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'near-miss');
  if (result.kind === 'near-miss') {
    assert.ok(result.notice.includes('retrieval gap detected'));
    assert.ok(result.notice.includes('daemon lifecycle'));
    assert.ok(result.notice.includes('best: 0.68'));
    assert.ok(result.notice.includes('floor: 0.725'));
    assert.equal(result.bestScore, 0.68);
  }
});

test('pipeline: near-miss with score just above noise floor', () => {
  const raw = [
    makeResult({ id: 'some-topic.md', filename: 'some-topic.md', similarity: 0.63, distance: 0.37 })
  ];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'near-miss');
});

test('pipeline: NOT a near-miss when score at noise floor (0.625)', () => {
  const raw = [
    makeResult({ id: 'noise.md', filename: 'noise.md', similarity: 0.625, distance: 0.375 })
  ];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'no-inject');
});

test('pipeline: NOT a near-miss when score is 0 (empty corpus match)', () => {
  const result = processSearchResults([], DEFAULT_CONFIG);
  assert.equal(result.kind, 'no-inject');
  if (result.kind === 'no-inject') {
    assert.equal(result.bestScore, 0);
  }
});

// --- Injection scenario ---

test('pipeline: injects when score clears the floor', () => {
  const raw = [
    makeResult({
      similarity: 0.82,
      distance: 0.18,
      document: 'The daemon uses HTTP on port 37800.'
    }),
    makeResult({
      id: 'config.md',
      filename: 'config.md',
      similarity: 0.76,
      distance: 0.24,
      document: 'Config hot-reloads on every query.'
    })
  ];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'inject');
  if (result.kind === 'inject') {
    assert.equal(result.included.length, 2);
    assert.ok(result.block.includes('contextus'));
    assert.ok(result.tokens > 0);
  }
});

test('pipeline: provenance footer included when configured', () => {
  const raw = [makeResult({ similarity: 0.8, distance: 0.2 })];
  const result = processSearchResults(raw, { ...DEFAULT_CONFIG, provenanceFooter: true });
  assert.equal(result.kind, 'inject');
  if (result.kind === 'inject') {
    assert.ok(result.block.includes('[contextus footer]'));
  }
});

test('pipeline: keyword fallback notice appended', () => {
  const raw = [makeResult({ similarity: 0.8, distance: 0.2 })];
  const result = processSearchResults(raw, DEFAULT_CONFIG, { usedKeywordFallback: true });
  assert.equal(result.kind, 'inject');
  if (result.kind === 'inject') {
    assert.ok(result.block.includes('keyword fallback'));
  }
});

// --- Floor boundary ---

test('pipeline: score exactly at floor is injected (>= check)', () => {
  const raw = [makeResult({ similarity: 0.725, distance: 0.275 })];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'inject');
});

test('pipeline: score just below floor triggers near-miss', () => {
  const raw = [makeResult({ similarity: 0.72, distance: 0.28 })];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'near-miss');
});

// --- Mixed results (some above floor, some below) ---

test('pipeline: mixed scores — injects what clears, drops what doesnt', () => {
  const raw = [
    makeResult({ id: 'good.md', filename: 'good.md', similarity: 0.8, distance: 0.2 }),
    makeResult({ id: 'weak.md', filename: 'weak.md', similarity: 0.65, distance: 0.35 })
  ];
  const result = processSearchResults(raw, DEFAULT_CONFIG);
  assert.equal(result.kind, 'inject');
  if (result.kind === 'inject') {
    assert.equal(result.included.length, 1);
    assert.equal(result.included[0].filename, 'good.md');
    assert.equal(result.floorDropped.length, 1);
    assert.equal(result.floorDropped[0].pattern, 'weak.md');
  }
});

// --- topK enforcement ---

test('pipeline: respects topK limit', () => {
  const raw = Array.from({ length: 10 }, (_, i) =>
    makeResult({
      id: `file-${i}.md`,
      filename: `file-${i}.md`,
      similarity: 0.75 + i * 0.01,
      distance: 0.25 - i * 0.01
    })
  );
  const config = { ...DEFAULT_CONFIG, topK: 3 };
  const result = processSearchResults(raw, config);
  assert.equal(result.kind, 'inject');
  if (result.kind === 'inject') {
    assert.ok(result.included.length <= 3);
  }
});

// --- Custom floor configuration ---

test('pipeline: higher floor makes more near-misses', () => {
  const raw = [makeResult({ similarity: 0.7, distance: 0.3 })];
  const strictConfig = { ...DEFAULT_CONFIG, injectionFloor: 0.75 };
  const result = processSearchResults(raw, strictConfig);
  assert.equal(result.kind, 'near-miss');
});

test('pipeline: lower floor makes fewer near-misses', () => {
  const raw = [makeResult({ similarity: 0.65, distance: 0.35 })];
  const lenientConfig = { ...DEFAULT_CONFIG, injectionFloor: 0.6 };
  const result = processSearchResults(raw, lenientConfig);
  assert.equal(result.kind, 'inject');
});
