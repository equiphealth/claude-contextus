/**
 * Re-ranker unit tests — composite score math, ordering, neutral fallbacks.
 * Pure logic, no daemon, no model load.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rerank,
  freshnessDecay,
  hitCountBoost,
  TYPE_BOOSTS,
} from '../lib/retrieval/reranker.js';
import type { SearchResult } from '../lib/storage/lance-client.js';

/** Build a minimal SearchResult with sane defaults. */
function row(overrides: Partial<SearchResult>): SearchResult {
  return {
    id: 'x',
    vector: [],
    document: 'doc',
    filename: 'x.md',
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '',
    distance: 0,
    similarity: 0.5,
    ...overrides,
  };
}

const FIXED_NOW = Date.parse('2026-06-14T00:00:00Z');

test('freshnessDecay: missing/invalid timestamp is neutral 1.0', () => {
  assert.equal(freshnessDecay(undefined, FIXED_NOW), 1.0);
  assert.equal(freshnessDecay('not-a-date', FIXED_NOW), 1.0);
});

test('freshnessDecay: ~0.5 at one half-life (180d), ~1.0 fresh', () => {
  const halfLifeAgo = new Date(FIXED_NOW - 180 * 86_400_000).toISOString();
  assert.ok(Math.abs(freshnessDecay(halfLifeAgo, FIXED_NOW) - 0.5) < 1e-9);
  const now = new Date(FIXED_NOW).toISOString();
  assert.ok(Math.abs(freshnessDecay(now, FIXED_NOW) - 1.0) < 1e-9);
});

test('freshnessDecay: future timestamp clamps to 1.0 (no boost)', () => {
  const future = new Date(FIXED_NOW + 30 * 86_400_000).toISOString();
  assert.equal(freshnessDecay(future, FIXED_NOW), 1.0);
});

test('hitCountBoost: monotonic, starts at 1.0, diminishing', () => {
  assert.equal(hitCountBoost(0), 1.0);
  assert.equal(hitCountBoost(undefined), 1.0);
  assert.ok(hitCountBoost(10) > hitCountBoost(1));
  // diminishing returns: an equal +1 step is worth less the higher the count
  assert.ok(hitCountBoost(101) - hitCountBoost(100) < hitCountBoost(2) - hitCountBoost(1));
});

test('rerank: unknown type falls back to neutral, never drops the row', () => {
  const out = rerank([row({ id: 'a', type: 'totally-unknown', similarity: 0.5 })], FIXED_NOW);
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].finalScore - 0.5) < 1e-9);
});

test('rerank: typeBoost changes ORDER (gotcha outranks equal-similarity phase)', () => {
  const out = rerank(
    [
      row({ id: 'phase', type: 'phase', similarity: 0.5 }),
      row({ id: 'gotcha', type: 'gotcha', similarity: 0.5 }),
    ],
    FIXED_NOW
  );
  assert.equal(out[0].id, 'gotcha');
  assert.ok(TYPE_BOOSTS.gotcha > TYPE_BOOSTS.phase);
});

test('rerank: returns a new sorted array (descending finalScore)', () => {
  const input = [
    row({ id: 'low', similarity: 0.2 }),
    row({ id: 'high', similarity: 0.9 }),
  ];
  const out = rerank(input, FIXED_NOW);
  assert.deepEqual(
    out.map((r) => r.id),
    ['high', 'low']
  );
  // original array untouched
  assert.equal(input[0].id, 'low');
});
