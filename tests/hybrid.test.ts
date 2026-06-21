import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseRRF, hybridKeywordSearch } from '../lib/retrieval/hybrid.js';
import type { SearchResult } from '../lib/storage/lance-client.js';
import type { KeywordSearchResult } from '../lib/retrieval/keyword.js';
import type { ContextRow } from '../lib/storage/lance-client.js';

function makeSearchResult(id: string, similarity: number): SearchResult {
  return {
    id,
    project: 'abc123def456',
    vector: [],
    document: `content for ${id}`,
    filename: `${id}.md`,
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '2026-06-01T00:00:00Z',
    content_hash: 'abc',
    distance: 1 - similarity,
    similarity
  };
}

function makeKeywordResult(id: string, score: number, similarity: number): KeywordSearchResult {
  return {
    ...makeSearchResult(id, similarity),
    keywordScore: score
  };
}

function makeRow(id: string, document: string): ContextRow {
  return {
    id,
    project: 'abc123def456',
    vector: [],
    document,
    filename: `${id}.md`,
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count: 0,
    last_hit: '',
    updated_at: '2026-06-01T00:00:00Z',
    content_hash: 'abc'
  };
}

// --- fuseRRF ---

test('fuseRRF: merges results from both lists', () => {
  const semantic = [
    makeSearchResult('a', 0.9),
    makeSearchResult('b', 0.7),
    makeSearchResult('c', 0.5)
  ];
  const keyword = [
    makeKeywordResult('b', 5.0, 1.0),
    makeKeywordResult('d', 4.0, 0.8),
    makeKeywordResult('a', 3.0, 0.6)
  ];
  const results = fuseRRF(semantic, keyword, 10);
  const ids = results.map((r) => r.id);
  // All unique IDs should be present
  assert.ok(ids.includes('a'));
  assert.ok(ids.includes('b'));
  assert.ok(ids.includes('c'));
  assert.ok(ids.includes('d'));
});

test('fuseRRF: documents in both lists rank higher', () => {
  const semantic = [makeSearchResult('both', 0.8), makeSearchResult('semantic-only', 0.9)];
  const keyword = [
    makeKeywordResult('both', 5.0, 1.0),
    makeKeywordResult('keyword-only', 4.0, 0.8)
  ];
  const results = fuseRRF(semantic, keyword, 10);
  // 'both' appears in both lists, should rank #1
  assert.equal(results[0].id, 'both');
});

test('fuseRRF: respects topK limit', () => {
  const semantic = Array.from({ length: 10 }, (_, i) => makeSearchResult(`s${i}`, 0.9 - i * 0.05));
  const keyword = Array.from({ length: 10 }, (_, i) =>
    makeKeywordResult(`k${i}`, 10 - i, (10 - i) / 10)
  );
  const results = fuseRRF(semantic, keyword, 5);
  assert.equal(results.length, 5);
});

test('fuseRRF: preserves semantic similarity for floor gating', () => {
  const semantic = [makeSearchResult('a', 0.9), makeSearchResult('b', 0.7)];
  const keyword = [makeKeywordResult('c', 5.0, 1.0)];
  const results = fuseRRF(semantic, keyword, 10);
  // Top result 'a' preserves its semantic similarity (not normalized to 1.0)
  assert.equal(results[0].similarity, 0.9);
  for (const r of results) {
    assert.ok(r.similarity >= 0 && r.similarity <= 1);
  }
});

test('fuseRRF: handles empty semantic list', () => {
  const keyword = [makeKeywordResult('a', 5.0, 1.0), makeKeywordResult('b', 3.0, 0.6)];
  const results = fuseRRF([], keyword, 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a');
});

test('fuseRRF: handles empty keyword list', () => {
  const semantic = [makeSearchResult('a', 0.9), makeSearchResult('b', 0.7)];
  const results = fuseRRF(semantic, [], 5);
  assert.equal(results.length, 2);
  assert.equal(results[0].id, 'a');
});

test('fuseRRF: handles both lists empty', () => {
  const results = fuseRRF([], [], 5);
  assert.deepEqual(results, []);
});

test('fuseRRF: preserves row metadata from semantic results (preferred)', () => {
  const semantic = [
    {
      ...makeSearchResult('a', 0.9),
      type: 'decision',
      source: 'projectContext',
      heading: 'Config Section'
    }
  ];
  const keyword = [
    {
      ...makeKeywordResult('a', 5.0, 1.0),
      type: 'reference', // different — semantic should win
      heading: 'Other'
    }
  ];
  const results = fuseRRF(semantic, keyword, 5);
  assert.equal(results[0].type, 'decision');
  assert.equal(results[0].heading, 'Config Section');
});

test('fuseRRF: includes rank information in results', () => {
  const semantic = [makeSearchResult('a', 0.9), makeSearchResult('b', 0.7)];
  const keyword = [makeKeywordResult('b', 5.0, 1.0), makeKeywordResult('c', 3.0, 0.6)];
  const results = fuseRRF(semantic, keyword, 10);
  const resultA = results.find((r) => r.id === 'a')!;
  const resultB = results.find((r) => r.id === 'b')!;
  const resultC = results.find((r) => r.id === 'c')!;
  assert.equal(resultA.semanticRank, 1);
  assert.equal(resultA.keywordRank, null);
  assert.equal(resultB.semanticRank, 2);
  assert.equal(resultB.keywordRank, 1);
  assert.equal(resultC.semanticRank, null);
  assert.equal(resultC.keywordRank, 2);
});

test('fuseRRF: exact symbol query that misses semantic gets lifted by keyword', () => {
  // Simulates "getLogger" — low semantic score (0.4, misses typical 0.45 floor)
  // but keyword nails it
  const semantic = [
    makeSearchResult('logger', 0.4),
    makeSearchResult('config', 0.6),
    makeSearchResult('embed', 0.5)
  ];
  const keyword = [
    makeKeywordResult('logger', 8.0, 1.0), // exact keyword match
    makeKeywordResult('util', 2.0, 0.25)
  ];
  const results = fuseRRF(semantic, keyword, 5);
  // 'logger' should be in top results despite low semantic score
  const loggerRank = results.findIndex((r) => r.id === 'logger');
  assert.ok(loggerRank <= 1, `logger ranked at ${loggerRank}, expected top 2`);
});

// --- hybridKeywordSearch ---

test('hybridKeywordSearch: uses 3x topK for wider candidate pool', () => {
  const corpus = Array.from({ length: 50 }, (_, i) =>
    makeRow(`row-${i}`, `document with shared search terms plus unique content${i}`)
  );
  const results = hybridKeywordSearch(corpus, 'shared search terms content', 5);
  // Should fetch up to topK * 3 = 15 candidates
  assert.ok(results.length <= 15);
  assert.ok(results.length > 0);
});

test('hybridKeywordSearch: returns empty for short queries', () => {
  const corpus = [makeRow('a', 'some content here')];
  const results = hybridKeywordSearch(corpus, 'x', 5);
  assert.deepEqual(results, []);
});
