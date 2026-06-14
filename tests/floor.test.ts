/**
 * Injection-floor unit tests — gate on RAW similarity, no-inject as success,
 * the critical "typeBoost must not lift a chunk over the floor" invariant.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFloor } from '../lib/retrieval/floor.js';
import type { RankedResult } from '../lib/retrieval/reranker.js';

function ranked(similarity: number, finalScore: number, id = 's'): RankedResult {
  return {
    id,
    vector: [],
    document: '',
    filename: `${id}.md`,
    type: 'reference',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '',
    distance: 0,
    similarity,
    finalScore,
  };
}

test('applyFloor: keeps at/above floor, drops below', () => {
  const r = applyFloor([ranked(0.6, 0.6, 'a'), ranked(0.3, 0.3, 'b')], 0.35);
  assert.deepEqual(
    r.kept.map((k) => k.id),
    ['a']
  );
  assert.deepEqual(
    r.dropped.map((d) => d.id),
    ['b']
  );
  assert.equal(r.noInject, false);
});

test('applyFloor: boundary is inclusive (similarity === floor is kept)', () => {
  const r = applyFloor([ranked(0.35, 0.35)], 0.35);
  assert.equal(r.kept.length, 1);
});

test('applyFloor: empty input → noInject, bestScore 0', () => {
  const r = applyFloor([], 0.35);
  assert.equal(r.noInject, true);
  assert.equal(r.kept.length, 0);
  assert.equal(r.bestScore, 0);
});

test('applyFloor: nothing clears → noInject true (first-class success)', () => {
  const r = applyFloor([ranked(0.1, 0.1), ranked(0.2, 0.2)], 0.35);
  assert.equal(r.noInject, true);
  assert.equal(r.dropped.length, 2);
});

test('applyFloor: gates on RAW similarity, NOT finalScore', () => {
  // A chunk whose typeBoost pushed finalScore well over the floor, but whose RAW
  // similarity is below it, MUST be dropped. This is the core floor invariant.
  const inflated = ranked(0.2, 0.9, 'inflated');
  const r = applyFloor([inflated], 0.35);
  assert.equal(r.noInject, true);
  assert.equal(r.kept.length, 0);
});

test('applyFloor: bestScore reports the max raw similarity seen', () => {
  const r = applyFloor([ranked(0.1, 0.1), ranked(0.28, 0.5)], 0.35);
  assert.equal(r.bestScore, 0.28);
});
