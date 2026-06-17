/**
 * Dedup unit tests — cosine near-duplicate folding, keep-first ordering,
 * threshold behavior, defensive handling of missing vectors.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, cosine, collapseByFile, DEFAULT_DEDUP_THRESHOLD } from '../lib/retrieval/dedup.js';
import type { RankedResult } from '../lib/retrieval/reranker.js';

function r(
  id: string,
  vector: number[],
  finalScore = 0.5,
  opts: { filename?: string; chunk_index?: number } = {}
): RankedResult {
  return {
    id,
    vector,
    document: '',
    filename: opts.filename ?? `${id}.md`,
    chunk_index: opts.chunk_index ?? 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '',
    distance: 0,
    similarity: finalScore,
    finalScore
  };
}

test('cosine: identical unit vectors → 1, orthogonal → 0, defensive on bad input', () => {
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine(undefined, [1, 0]), 0);
  assert.equal(cosine([1, 0], [1, 0, 0]), 0); // length mismatch
});

test('collapseByFile: keeps one best-finalScore chunk per filename, preserves order', () => {
  // file A: two chunks (0.9, 0.6) → keep 0.9; file B: one chunk (0.7).
  const a1 = r('a#0', [1, 0], 0.6, { filename: 'a.md', chunk_index: 0 });
  const a2 = r('a#1', [0, 1], 0.9, { filename: 'a.md', chunk_index: 1 });
  const b0 = r('b#0', [1, 1], 0.7, { filename: 'b.md', chunk_index: 0 });
  // input is best-first (rerank order): a2(0.9), b0(0.7), a1(0.6)
  const out = collapseByFile([a2, b0, a1]);
  assert.deepEqual(
    out.map((x) => x.filename),
    ['a.md', 'b.md'],
    'one row per file, first-seen order'
  );
  assert.equal(out[0].finalScore, 0.9, "kept file A's best chunk");
});

test('collapseByFile: 5 chunks of one file collapse to a single representative', () => {
  const chunks = [0.8, 0.7, 0.6, 0.5, 0.4].map((s, i) =>
    r(`d#${i}`, [s, 1 - s], s, { filename: 'DESIGN.md', chunk_index: i })
  );
  const out = collapseByFile(chunks);
  assert.equal(out.length, 1);
  assert.equal(out[0].finalScore, 0.8);
});

test('dedupe: drops a near-identical lower-ranked chunk, keeps the first', () => {
  const a = r('a', [1, 0, 0], 0.9);
  const b = r('b', [0.999, 0.0447, 0], 0.8); // ~0.999 cosine with a
  const out = dedupe([a, b]);
  assert.deepEqual(
    out.kept.map((x) => x.id),
    ['a']
  );
  assert.equal(out.dropped.length, 1);
  assert.equal(out.dropped[0].chunk.id, 'b');
  assert.equal(out.dropped[0].duplicateOf, 'a.md');
});

test('dedupe: keeps distinct chunks', () => {
  const out = dedupe([r('a', [1, 0, 0]), r('b', [0, 1, 0]), r('c', [0, 0, 1])]);
  assert.equal(out.kept.length, 3);
  assert.equal(out.dropped.length, 0);
});

test('dedupe: threshold respected (just-below stays, at/above folds)', () => {
  const a = r('a', [1, 0]);
  const near = r('b', [0.96, 0.28]); // cosine ~0.96
  assert.equal(dedupe([a, near], 0.97).kept.length, 2); // below 0.97 → keep both
  assert.equal(dedupe([a, near], 0.95).kept.length, 1); // above 0.95 → fold
});

test('dedupe: a chunk without a vector is never folded (cosine 0)', () => {
  const out = dedupe([r('a', [1, 0]), r('b', [])]);
  assert.equal(out.kept.length, 2);
});

test('DEFAULT_DEDUP_THRESHOLD is conservative (high)', () => {
  assert.ok(DEFAULT_DEDUP_THRESHOLD >= 0.9);
});
