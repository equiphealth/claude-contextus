/**
 * Intelligent host-ceiling fit — unit tests (Muse edge seam).
 *
 * `fitBlockToCeiling` drops lowest-ranked chunks first (finalScore, falling
 * back to similarity), replacing each with a one-line reference, keeping the
 * header, fallback notice, and provenance footer intact, and marking the
 * truncation with count + paths. Under the ceiling it is the identity
 * function. Pure function, no daemon needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitBlockToCeiling } from '../lib/retrieval/inject-format.js';
import type { RankedResult } from '../lib/retrieval/reranker.js';

function chunk(partial: Partial<RankedResult> & { id: string }): RankedResult {
  return {
    project: 'p',
    vector: [],
    document: 'body',
    filename: 'f.md',
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: '',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '',
    distance: 0,
    similarity: 0.8,
    finalScore: 0.8,
    ...partial
  };
}

const BIG = 800; // sized so one survivor + marker + footer fits 1800B, two survivors do not

test('fitBlockToCeiling: under ceiling is byte-identical, untruncated', () => {
  const kept = [
    chunk({ id: 'a', filename: 'a.md', document: 'alpha', similarity: 0.9, finalScore: 0.9 }),
    chunk({ id: 'b', filename: 'b.md', document: 'beta', similarity: 0.7, finalScore: 0.7 })
  ];
  const fit = fitBlockToCeiling({
    kept,
    maxTokens: 3000,
    fallbackNotice: false,
    provenanceFooter: true,
    byteCeiling: 1_000_000
  });
  const plain = fitBlockToCeiling({
    ...{ kept, maxTokens: 3000, fallbackNotice: false, provenanceFooter: true },
    byteCeiling: 0
  });
  assert.equal(fit.truncated, false);
  assert.deepEqual(fit.dropped, []);
  assert.equal(fit.block, plain.block, 'huge ceiling and no ceiling must agree byte-for-byte');
  assert.ok(fit.block.includes('[contextus'), 'header intact');
  assert.ok(
    fit.block.includes('a.md (0.90), b.md (0.70)'),
    'footer whitelists exactly the injected files'
  );
});

test('fitBlockToCeiling: drops lowest-ranked first, refs + marker, footer intact', () => {
  const kept = [
    chunk({
      id: 'top',
      filename: 'top.md',
      document: 'T'.repeat(BIG),
      similarity: 0.95,
      finalScore: 0.95
    }),
    chunk({
      id: 'mid',
      filename: 'mid.md',
      document: 'M'.repeat(BIG),
      similarity: 0.8,
      finalScore: 0.8
    }),
    chunk({
      id: 'low',
      filename: 'low.md',
      document: 'L'.repeat(BIG),
      similarity: 0.6,
      finalScore: 0.6
    })
  ];
  const fit = fitBlockToCeiling({
    kept,
    maxTokens: 100000,
    fallbackNotice: false,
    provenanceFooter: true,
    byteCeiling: 1800
  });
  assert.equal(fit.truncated, true);
  assert.ok(Buffer.byteLength(fit.block, 'utf8') <= 1800);
  // Lowest-ranked dropped first; top survives in full.
  assert.ok(
    fit.dropped.some((r) => r.id === 'low'),
    'lowest score dropped'
  );
  assert.ok(fit.block.includes('T'.repeat(100)), 'top chunk body intact, never split mid-line');
  assert.ok(!fit.block.includes('L'.repeat(100)), 'dropped chunk body gone');
  // One-line reference with path + score, plus marker with count + paths.
  assert.ok(fit.block.includes('- low.md (0.60)'), 'dropped chunk replaced by one-line reference');
  assert.ok(fit.block.includes('[contextus: truncated'), 'truncation explicitly marked');
  assert.ok(fit.block.includes('retrieve full text via /context-search'), 'recovery path named');
  // Footer stays intact and truthful (lists survivors, not dropped).
  assert.ok(fit.block.includes('[contextus footer]'), 'footer intact');
});

test('fitBlockToCeiling: drop order follows rank, not input order', () => {
  const low = chunk({
    id: 'low',
    filename: 'low.md',
    document: 'L'.repeat(BIG),
    similarity: 0.6,
    finalScore: 0.6
  });
  const high = chunk({
    id: 'high',
    filename: 'high.md',
    document: 'H'.repeat(BIG),
    similarity: 0.95,
    finalScore: 0.95
  });
  const fit = fitBlockToCeiling({
    kept: [low, high], // lowest first on purpose
    maxTokens: 100000,
    fallbackNotice: false,
    provenanceFooter: false,
    byteCeiling: 1500
  });
  assert.ok(fit.dropped.some((r) => r.id === 'low'));
  assert.ok(fit.block.includes('H'.repeat(100)));
});

test('fitBlockToCeiling: heading appears in the reference line', () => {
  const kept = [
    chunk({
      id: 'top',
      filename: 'top.md',
      document: 'T'.repeat(BIG),
      similarity: 0.95,
      finalScore: 0.95
    }),
    chunk({
      id: 'low',
      filename: 'low.md',
      heading: 'Setup',
      document: 'L'.repeat(BIG),
      similarity: 0.6,
      finalScore: 0.6
    })
  ];
  const fit = fitBlockToCeiling({
    kept,
    maxTokens: 100000,
    fallbackNotice: false,
    provenanceFooter: false,
    byteCeiling: 1500
  });
  assert.ok(fit.block.includes('- low.md › Setup (0.60)'));
});

test('fitBlockToCeiling: single over-cap chunk degrades to refs, never a blind cut', () => {
  const kept = [
    chunk({
      id: 'only',
      filename: 'only.md',
      document: 'Z'.repeat(BIG),
      similarity: 0.9,
      finalScore: 0.9
    })
  ];
  const fit = fitBlockToCeiling({
    kept,
    maxTokens: 100000,
    fallbackNotice: false,
    provenanceFooter: false,
    byteCeiling: 500
  });
  assert.equal(fit.truncated, true);
  assert.ok(!fit.block.includes('�'), 'no replacement characters from split sequences');
  assert.ok(fit.block.includes('- only.md (0.90)'), 'chunk survives as a reference');
  assert.ok(fit.block.includes('[contextus: truncated'), 'marked');
});
