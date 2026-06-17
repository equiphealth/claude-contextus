import { test, mock, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldExpand,
  parseVariants,
  buildPrompt,
  expandQuery,
  type ExpandedQueries,
} from '../lib/retrieval/expand.js';
import type { ExpansionConfig } from '../lib/config.js';

// --- shouldExpand ---

test('shouldExpand: off mode always returns false', () => {
  assert.equal(shouldExpand('off', 0.2, 0.55), false);
  assert.equal(shouldExpand('off', 0.9, 0.55), false);
});

test('shouldExpand: always mode always returns true', () => {
  assert.equal(shouldExpand('always', 0.2, 0.55), true);
  assert.equal(shouldExpand('always', 0.9, 0.55), true);
});

test('shouldExpand: adaptive fires when best score is below threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.4, 0.55), true);
  assert.equal(shouldExpand('adaptive', 0.54, 0.55), true);
});

test('shouldExpand: adaptive does not fire when best score meets threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.55, 0.55), false);
  assert.equal(shouldExpand('adaptive', 0.7, 0.55), false);
});

test('shouldExpand: adaptive with custom threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.6, 0.65), true);
  assert.equal(shouldExpand('adaptive', 0.66, 0.65), false);
});

// --- parseVariants ---

test('parseVariants: splits lines and trims', () => {
  const raw = '  How to configure settings  \nWhat are the options for setup\n  Where is the config file  ';
  const result = parseVariants(raw, 3);
  assert.deepEqual(result, [
    'How to configure settings',
    'What are the options for setup',
    'Where is the config file',
  ]);
});

test('parseVariants: filters lines shorter than 6 chars', () => {
  const raw = 'Good variant here\nhi\nok\nAnother good variant';
  const result = parseVariants(raw, 5);
  assert.deepEqual(result, ['Good variant here', 'Another good variant']);
});

test('parseVariants: filters lines longer than 200 chars', () => {
  const long = 'x'.repeat(201);
  const raw = `Short variant\n${long}\nAnother short`;
  const result = parseVariants(raw, 5);
  assert.deepEqual(result, ['Short variant', 'Another short']);
});

test('parseVariants: respects maxVariants limit', () => {
  const raw = 'Variant one\nVariant two\nVariant three\nVariant four';
  const result = parseVariants(raw, 2);
  assert.equal(result.length, 2);
  assert.deepEqual(result, ['Variant one', 'Variant two']);
});

test('parseVariants: handles empty string', () => {
  assert.deepEqual(parseVariants('', 3), []);
});

test('parseVariants: skips empty lines', () => {
  const raw = 'Variant one\n\n\nVariant two\n   \nVariant three';
  const result = parseVariants(raw, 5);
  assert.deepEqual(result, ['Variant one', 'Variant two', 'Variant three']);
});

test('parseVariants: handles numbered output from LLM (numbers get kept but line passes)', () => {
  const raw = '1. What is the embedding config\n2. How to set up vector search\n3. Where are settings stored';
  const result = parseVariants(raw, 3);
  assert.equal(result.length, 3);
});

// --- buildPrompt ---

test('buildPrompt: substitutes count and query', () => {
  const result = buildPrompt('How do I configure embeddings?', 3);
  assert.match(result, /into 3 alternative/);
  assert.match(result, /How do I configure embeddings\?/);
});

test('buildPrompt: handles special regex chars in query', () => {
  const result = buildPrompt('config.$ref [test]', 2);
  assert.match(result, /config\.\$ref \[test\]/);
});

// --- expandQuery (fallback/failure paths) ---

const baseCfg: ExpansionConfig = {
  mode: 'adaptive',
  provider: 'ollama',
  ollamaModel: 'qwen2.5:3b',
  anthropicModel: 'claude-haiku-4-5-20251001',
  ollamaEndpoint: 'http://localhost:99999', // unreachable
  expansionThreshold: 0.55,
  maxVariants: 3,
  temperature: 0.7,
  timeoutMs: 500,
};

test('expandQuery: returns empty variants on network failure (ollama)', async () => {
  const result = await expandQuery('test query', baseCfg);
  assert.deepEqual(result.variants, []);
  assert.equal(result.provider, 'ollama');
});

test('expandQuery: returns empty variants on network failure (anthropic)', async () => {
  const cfg = { ...baseCfg, provider: 'anthropic' as const };
  const result = await expandQuery('test query', cfg);
  assert.deepEqual(result.variants, []);
  assert.equal(result.provider, 'anthropic');
});

test('expandQuery: returns empty variants when anthropic key missing', async () => {
  const origKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const cfg = {
      ...baseCfg,
      provider: 'anthropic' as const,
      ollamaEndpoint: 'http://localhost:11434',
    };
    const result = await expandQuery('test query', cfg);
    assert.deepEqual(result.variants, []);
  } finally {
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  }
});

// --- expandQuery with mocked fetch (ollama success path) ---

test('expandQuery: parses ollama response correctly', async () => {
  const mockResponse = {
    response: 'How to set up vector search\nWhere are embedding settings\nConfigure the retrieval system',
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => mockResponse,
  })) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, ollamaEndpoint: 'http://localhost:11434' };
    const result = await expandQuery('How do I configure embeddings?', cfg);
    assert.equal(result.variants.length, 3);
    assert.equal(result.provider, 'ollama/qwen2.5:3b');
    assert.ok(result.latencyMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expandQuery: parses anthropic response correctly', async () => {
  const mockResponse = {
    content: [{ text: 'How to set up vector search\nWhere are embedding settings\nConfigure the retrieval system' }],
  };

  const originalFetch = globalThis.fetch;
  const origKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => mockResponse,
  })) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, provider: 'anthropic' as const };
    const result = await expandQuery('How do I configure embeddings?', cfg);
    assert.equal(result.variants.length, 3);
    assert.equal(result.provider, 'anthropic/claude-haiku-4-5-20251001');
  } finally {
    globalThis.fetch = originalFetch;
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('expandQuery: handles non-ok HTTP response gracefully', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => ({
    ok: false,
    status: 500,
  })) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, ollamaEndpoint: 'http://localhost:11434' };
    const result = await expandQuery('test', cfg);
    assert.deepEqual(result.variants, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expandQuery: handles garbage LLM output gracefully', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock.fn(async () => ({
    ok: true,
    json: async () => ({ response: 'a\nb\nc\nd\ne' }), // all too short
  })) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, ollamaEndpoint: 'http://localhost:11434' };
    const result = await expandQuery('test', cfg);
    assert.deepEqual(result.variants, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- Union dedup logic (mirrors daemon/server.ts:212-224) ---
// This exercises the same algorithm used in handleQuery without requiring the daemon.

type SearchResult = { id: string; similarity: number; filename: string };

function unionDedup(original: SearchResult[], variantSearches: SearchResult[][]): SearchResult[] {
  const seen = new Map<string, SearchResult>();
  for (const r of original) seen.set(r.id, r);
  for (const results of variantSearches) {
    for (const r of results) {
      const existing = seen.get(r.id);
      if (!existing || r.similarity > existing.similarity) {
        seen.set(r.id, r);
      }
    }
  }
  return Array.from(seen.values());
}

describe('union dedup logic', () => {
  test('keeps highest similarity when same id appears in multiple searches', () => {
    const original: SearchResult[] = [
      { id: 'chunk-1', similarity: 0.5, filename: 'a.md' },
      { id: 'chunk-2', similarity: 0.4, filename: 'b.md' },
    ];
    const variants: SearchResult[][] = [
      [
        { id: 'chunk-1', similarity: 0.7, filename: 'a.md' }, // higher
        { id: 'chunk-3', similarity: 0.6, filename: 'c.md' }, // new
      ],
    ];
    const result = unionDedup(original, variants);
    assert.equal(result.length, 3);
    const chunk1 = result.find((r) => r.id === 'chunk-1')!;
    assert.equal(chunk1.similarity, 0.7);
  });

  test('does not downgrade similarity from original', () => {
    const original: SearchResult[] = [{ id: 'chunk-1', similarity: 0.8, filename: 'a.md' }];
    const variants: SearchResult[][] = [[{ id: 'chunk-1', similarity: 0.5, filename: 'a.md' }]];
    const result = unionDedup(original, variants);
    assert.equal(result[0].similarity, 0.8);
  });

  test('merges results from multiple variant searches', () => {
    const original: SearchResult[] = [{ id: 'chunk-1', similarity: 0.4, filename: 'a.md' }];
    const variants: SearchResult[][] = [
      [{ id: 'chunk-2', similarity: 0.6, filename: 'b.md' }],
      [{ id: 'chunk-3', similarity: 0.5, filename: 'c.md' }],
      [{ id: 'chunk-2', similarity: 0.65, filename: 'b.md' }], // upgrade chunk-2
    ];
    const result = unionDedup(original, variants);
    assert.equal(result.length, 3);
    assert.equal(result.find((r) => r.id === 'chunk-2')!.similarity, 0.65);
  });

  test('handles empty original (no initial results)', () => {
    const variants: SearchResult[][] = [
      [
        { id: 'chunk-1', similarity: 0.6, filename: 'a.md' },
        { id: 'chunk-2', similarity: 0.5, filename: 'b.md' },
      ],
    ];
    const result = unionDedup([], variants);
    assert.equal(result.length, 2);
  });

  test('handles empty variant searches', () => {
    const original: SearchResult[] = [{ id: 'chunk-1', similarity: 0.5, filename: 'a.md' }];
    const result = unionDedup(original, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'chunk-1');
  });
});

// --- initialBest computation ---

describe('initialBest computation', () => {
  test('picks max similarity from results', () => {
    const raw = [
      { similarity: 0.3 },
      { similarity: 0.6 },
      { similarity: 0.45 },
    ];
    const initialBest = raw.length > 0 ? Math.max(...raw.map((r) => r.similarity)) : 0;
    assert.equal(initialBest, 0.6);
  });

  test('returns 0 when no results', () => {
    const raw: { similarity: number }[] = [];
    const initialBest = raw.length > 0 ? Math.max(...raw.map((r) => r.similarity)) : 0;
    assert.equal(initialBest, 0);
  });

  test('handles single result', () => {
    const raw = [{ similarity: 0.42 }];
    const initialBest = raw.length > 0 ? Math.max(...raw.map((r) => r.similarity)) : 0;
    assert.equal(initialBest, 0.42);
  });

  test('feeds into shouldExpand correctly (adaptive trigger)', () => {
    const raw = [{ similarity: 0.5 }, { similarity: 0.53 }];
    const initialBest = Math.max(...raw.map((r) => r.similarity));
    assert.equal(shouldExpand('adaptive', initialBest, 0.55), true);
    assert.equal(shouldExpand('adaptive', initialBest, 0.5), false);
  });
});
