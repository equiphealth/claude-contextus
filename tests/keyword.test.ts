import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, keywordSearch } from '../lib/retrieval/keyword.js';
import type { ContextRow } from '../lib/storage/lance-client.js';

function makeRow(overrides: Partial<ContextRow> = {}): ContextRow {
  return {
    id: overrides.id ?? 'test-row',
    vector: [],
    document: overrides.document ?? 'default document content',
    filename: overrides.filename ?? 'test.md',
    chunk_index: overrides.chunk_index ?? 0,
    heading: overrides.heading ?? '',
    type: overrides.type ?? 'reference',
    source: overrides.source ?? 'projectContext',
    tags: overrides.tags ?? '',
    hit_count: overrides.hit_count ?? 0,
    last_hit: overrides.last_hit ?? '',
    updated_at: overrides.updated_at ?? '2026-06-01T00:00:00Z',
    content_hash: overrides.content_hash ?? 'abc123'
  };
}

// --- tokenize ---

test('tokenize: lowercases and splits on whitespace', () => {
  assert.deepEqual(tokenize('Hello World'), ['hello', 'world']);
});

test('tokenize: strips punctuation', () => {
  assert.deepEqual(tokenize('config.retrieval.topK'), ['config', 'retrieval', 'topk']);
});

test('tokenize: drops single-char tokens', () => {
  assert.deepEqual(tokenize('a b cd ef'), ['cd', 'ef']);
});

test('tokenize: handles camelCase as one token', () => {
  const result = tokenize('getLogger expandHome');
  assert.deepEqual(result, ['getlogger', 'expandhome']);
});

test('tokenize: handles empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

test('tokenize: handles code-like content', () => {
  const result = tokenize('import { search } from "./lance-client.js"');
  assert.ok(result.includes('import'));
  assert.ok(result.includes('search'));
  assert.ok(result.includes('from'));
  assert.ok(result.includes('lance'));
  assert.ok(result.includes('client'));
});

// --- keywordSearch ---

test('keywordSearch: returns empty for queries < 2 terms', () => {
  const rows = [makeRow({ document: 'hello world this is content' })];
  assert.deepEqual(keywordSearch(rows, 'hello', 5), []);
  assert.deepEqual(keywordSearch(rows, '', 5), []);
  assert.deepEqual(keywordSearch(rows, 'a', 5), []);
});

test('keywordSearch: finds documents matching query terms', () => {
  const rows = [
    makeRow({ id: 'config', document: 'retrieval configuration with topK and injection floor' }),
    makeRow({ id: 'logger', document: 'logging system for daemon with rotation and archival' }),
    makeRow({ id: 'embed', document: 'embedding model warmup and vector dimensions' })
  ];
  const results = keywordSearch(rows, 'retrieval injection floor', 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'config');
});

test('keywordSearch: respects topK limit', () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    makeRow({ id: `row-${i}`, document: `shared term plus unique word${i} content` })
  );
  const results = keywordSearch(rows, 'shared term content', 3);
  assert.ok(results.length <= 3);
});

test('keywordSearch: similarity is normalized to [0, 1]', () => {
  const rows = [
    makeRow({ id: 'best', document: 'exact match search query terms repeated terms' }),
    makeRow({ id: 'partial', document: 'some match with other words' }),
    makeRow({ id: 'none', document: 'completely unrelated content about cooking' })
  ];
  const results = keywordSearch(rows, 'exact match search terms', 5);
  assert.ok(results.length >= 1);
  assert.equal(results[0].similarity, 1); // best is always 1
  for (const r of results) {
    assert.ok(r.similarity >= 0 && r.similarity <= 1);
  }
});

test('keywordSearch: results are sorted by score descending', () => {
  const rows = [
    makeRow({ id: 'low', document: 'other stuff entirely different' }),
    makeRow({ id: 'high', document: 'keyword search fallback embedding provider down' }),
    makeRow({ id: 'mid', document: 'the embedding is used for search' })
  ];
  const results = keywordSearch(rows, 'keyword search embedding provider', 5);
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].keywordScore >= results[i].keywordScore);
  }
});

test('keywordSearch: returns empty when no documents match', () => {
  const rows = [
    makeRow({ id: 'a', document: 'about cooking recipes and food preparation' }),
    makeRow({ id: 'b', document: 'gardening tips for spring planting season' })
  ];
  const results = keywordSearch(rows, 'vector embedding model', 5);
  assert.equal(results.length, 0);
});

test('keywordSearch: handles empty corpus', () => {
  const results = keywordSearch([], 'some query terms', 5);
  assert.deepEqual(results, []);
});

test('keywordSearch: preserves row metadata in results', () => {
  const rows = [
    makeRow({
      id: 'config/retrieval.md',
      document: 'retrieval configuration topK injection floor',
      filename: 'config/retrieval.md',
      type: 'reference',
      source: 'projectContext',
      heading: 'Configuration',
      hit_count: 5
    })
  ];
  const results = keywordSearch(rows, 'retrieval injection configuration', 5);
  assert.equal(results.length, 1);
  assert.equal(results[0].filename, 'config/retrieval.md');
  assert.equal(results[0].type, 'reference');
  assert.equal(results[0].source, 'projectContext');
  assert.equal(results[0].heading, 'Configuration');
  assert.equal(results[0].hit_count, 5);
});

test('keywordSearch: exact symbol queries find the right document', () => {
  const rows = [
    makeRow({
      id: 'logger',
      document: 'export function getLogger(name) { return new Logger(name); }'
    }),
    makeRow({
      id: 'config',
      document: 'export function loadConfig() { return merge(defaults, file); }'
    }),
    makeRow({
      id: 'util',
      document: 'export function expandHome(p) { return p.replace("~", home); }'
    })
  ];
  const results = keywordSearch(rows, 'getLogger function', 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'logger');
});

test('keywordSearch: ranks documents with more matching terms higher', () => {
  const rows = [
    makeRow({ id: 'one-term', document: 'the embedding model loads data' }),
    makeRow({ id: 'two-terms', document: 'the embedding model warmup and vector search' }),
    makeRow({
      id: 'three-terms',
      document: 'embedding model warmup followed by vector search and corpus indexing'
    })
  ];
  const results = keywordSearch(rows, 'embedding warmup vector search corpus', 5);
  assert.ok(results.length >= 2);
  // More matching terms should score higher
  const threeIdx = results.findIndex((r) => r.id === 'three-terms');
  const oneIdx = results.findIndex((r) => r.id === 'one-term');
  if (threeIdx !== -1 && oneIdx !== -1) {
    assert.ok(threeIdx < oneIdx);
  }
});

test('keywordSearch: IDF gives rare terms more weight than common ones', () => {
  // "rare" appears in one doc, "common" appears in all
  const rows = [
    makeRow({ id: 'has-rare', document: 'common word rare special term' }),
    makeRow({ id: 'common-only-1', document: 'common word regular boring stuff' }),
    makeRow({ id: 'common-only-2', document: 'common word another normal doc' })
  ];
  const results = keywordSearch(rows, 'common rare term', 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, 'has-rare');
});
