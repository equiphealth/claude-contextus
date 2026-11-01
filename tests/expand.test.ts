import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  shouldExpand,
  parseVariants,
  buildPrompt,
  expandQuery,
  resolveMetaApiKey,
  resolveAnthropicApiKey,
  type ExpandedQueries
} from '../lib/retrieval/expand.js';
import { readApiKeyFile, describeApiKeyFileFailure } from '../lib/config.js';
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
  const raw =
    '  How to configure settings  \nWhat are the options for setup\n  Where is the config file  ';
  const result = parseVariants(raw, 3);
  assert.deepEqual(result, [
    'How to configure settings',
    'What are the options for setup',
    'Where is the config file'
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
  const raw =
    '1. What is the embedding config\n2. How to set up vector search\n3. Where are settings stored';
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

import type { ProvidersConfig } from '../lib/config.js';

const baseCfg: ExpansionConfig = {
  mode: 'adaptive',
  provider: 'ollama',
  model: 'qwen2.5:3b',
  fallbackProvider: 'anthropic',
  fallbackModel: 'claude-haiku-4-5-20251001',
  expansionThreshold: 0.55,
  maxVariants: 3,
  temperature: 0.7,
  timeoutMs: 500
};

const baseProviders: ProvidersConfig = {
  ollama: { endpoint: 'http://localhost:99999' }, // unreachable
  bedrock: { region: 'us-east-1' },
  anthropic: {}
};

test('expandQuery: returns empty variants on network failure (ollama)', async () => {
  const result = await expandQuery('test query', baseCfg, baseProviders);
  assert.deepEqual(result.variants, []);
  assert.equal(result.provider, 'ollama');
});

test('expandQuery: returns empty variants on network failure (anthropic)', async () => {
  const cfg = {
    ...baseCfg,
    provider: 'anthropic' as const,
    model: 'claude-haiku-4-5-20251001',
    fallbackProvider: undefined,
    fallbackModel: undefined
  };
  const result = await expandQuery('test query', cfg, baseProviders);
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
      model: 'claude-haiku-4-5-20251001',
      fallbackProvider: undefined,
      fallbackModel: undefined
    };
    const result = await expandQuery('test query', cfg, baseProviders);
    assert.deepEqual(result.variants, []);
  } finally {
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  }
});

// --- expandQuery with mocked fetch (ollama success path) ---

test('expandQuery: parses ollama response correctly', async () => {
  const mockResponse = {
    response:
      'How to set up vector search\nWhere are embedding settings\nConfigure the retrieval system'
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => mockResponse
  })) as unknown as typeof fetch;

  try {
    const providers = { ...baseProviders, ollama: { endpoint: 'http://localhost:11434' } };
    const result = await expandQuery('How do I configure embeddings?', baseCfg, providers);
    assert.equal(result.variants.length, 3);
    assert.equal(result.provider, 'ollama/qwen2.5:3b');
    assert.ok(result.latencyMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expandQuery: parses anthropic response correctly', async () => {
  const mockResponse = {
    content: [
      {
        text: 'How to set up vector search\nWhere are embedding settings\nConfigure the retrieval system'
      }
    ]
  };

  const originalFetch = globalThis.fetch;
  const origKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => mockResponse
  })) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, provider: 'anthropic' as const, model: 'claude-haiku-4-5-20251001' };
    const result = await expandQuery('How do I configure embeddings?', cfg, baseProviders);
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
  globalThis.fetch = (async () => ({
    ok: false,
    status: 500
  })) as unknown as typeof fetch;

  try {
    const providers = { ...baseProviders, ollama: { endpoint: 'http://localhost:11434' } };
    const result = await expandQuery('test', baseCfg, providers);
    assert.deepEqual(result.variants, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('expandQuery: handles garbage LLM output gracefully', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ response: 'a\nb\nc\nd\ne' })
  })) as unknown as typeof fetch;

  try {
    const providers = { ...baseProviders, ollama: { endpoint: 'http://localhost:11434' } };
    const result = await expandQuery('test', baseCfg, providers);
    assert.deepEqual(result.variants, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- expandQuery fallback (ollama down → anthropic) ---

test('expandQuery: falls back to anthropic when ollama fails fast', async () => {
  const originalFetch = globalThis.fetch;
  const origKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let callCount = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    callCount++;
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('localhost')) {
      throw new Error('Connection refused');
    }
    return {
      ok: true,
      json: async () => ({
        content: [
          {
            text: 'What vector encoder is the default\nWhich embedding model ships by default\nDefault vector model configuration'
          }
        ]
      })
    };
  }) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, timeoutMs: 5000 };
    const providers = { ...baseProviders, ollama: { endpoint: 'http://localhost:11434' } };
    const result = await expandQuery('What is the default vector model?', cfg, providers);
    assert.equal(callCount, 2, `expected 2 fetch calls, got ${callCount}`);
    assert.equal(result.provider, 'anthropic/claude-haiku-4-5-20251001');
    assert.equal(result.variants.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    else delete process.env.ANTHROPIC_API_KEY;
  }
});

test('expandQuery: does not fall back when no fallback configured', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('Connection refused');
  }) as unknown as typeof fetch;

  try {
    const cfg = { ...baseCfg, fallbackProvider: undefined, fallbackModel: undefined };
    const providers = { ...baseProviders, ollama: { endpoint: 'http://localhost:11434' } };
    const result = await expandQuery('test query here', cfg, providers);
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
      { id: 'chunk-2', similarity: 0.4, filename: 'b.md' }
    ];
    const variants: SearchResult[][] = [
      [
        { id: 'chunk-1', similarity: 0.7, filename: 'a.md' }, // higher
        { id: 'chunk-3', similarity: 0.6, filename: 'c.md' } // new
      ]
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
      [{ id: 'chunk-2', similarity: 0.65, filename: 'b.md' }] // upgrade chunk-2
    ];
    const result = unionDedup(original, variants);
    assert.equal(result.length, 3);
    assert.equal(result.find((r) => r.id === 'chunk-2')!.similarity, 0.65);
  });

  test('handles empty original (no initial results)', () => {
    const variants: SearchResult[][] = [
      [
        { id: 'chunk-1', similarity: 0.6, filename: 'a.md' },
        { id: 'chunk-2', similarity: 0.5, filename: 'b.md' }
      ]
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
    const raw = [{ similarity: 0.3 }, { similarity: 0.6 }, { similarity: 0.45 }];
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

// --- File-based API key resolution ---

describe('readApiKeyFile', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-key-test-'));

  test('reads and trims a valid key file', () => {
    const file = path.join(tmpDir, 'key-valid');
    fs.writeFileSync(file, '  sk-test-123  \n', { mode: 0o600 });
    const result = readApiKeyFile(file);
    assert.deepEqual(result, { ok: true, key: 'sk-test-123' });
  });

  test('reports not-found for a missing path', () => {
    const result = readApiKeyFile(path.join(tmpDir, 'does-not-exist'));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'not-found');
      assert.match(describeApiKeyFileFailure(result), /not found/);
    }
  });

  test('reports empty for a file with only whitespace', () => {
    const file = path.join(tmpDir, 'key-empty');
    fs.writeFileSync(file, '   \n', { mode: 0o600 });
    const result = readApiKeyFile(file);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'empty');
      assert.match(describeApiKeyFileFailure(result), /empty/);
    }
  });

  test('never includes file contents in a failure description', () => {
    const file = path.join(tmpDir, 'key-secret');
    fs.writeFileSync(file, 'super-secret-value', { mode: 0o600 });
    // Force an "unreadable" case via a directory path instead of a file —
    // statSync succeeds (it's a real path) but readFileSync on a directory throws.
    const dirAsFile = path.join(tmpDir, 'a-directory');
    fs.mkdirSync(dirAsFile);
    const result = readApiKeyFile(dirAsFile);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'unreadable');
      const msg = describeApiKeyFileFailure(result);
      assert.ok(!msg.includes('super-secret-value'));
    }
  });
});

describe('resolveMetaApiKey', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-meta-key-test-'));
  const origMetaKey = process.env.META_API_KEY;
  const origModelKey = process.env.MODEL_API_KEY;

  test('apiKeyFile wins over env vars when both are set', () => {
    process.env.META_API_KEY = 'env-value-should-not-win';
    const file = path.join(tmpDir, 'meta-key');
    fs.writeFileSync(file, 'file-value\n', { mode: 0o600 });
    try {
      assert.equal(resolveMetaApiKey(undefined, file), 'file-value');
    } finally {
      if (origMetaKey === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = origMetaKey;
    }
  });

  test('throws (fails loud) when apiKeyFile is configured but broken, never silently falls through to env', () => {
    process.env.META_API_KEY = 'env-value-should-not-be-used';
    const missingFile = path.join(tmpDir, 'does-not-exist');
    try {
      assert.throws(() => resolveMetaApiKey(undefined, missingFile), /key file not found/);
    } finally {
      if (origMetaKey === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = origMetaKey;
    }
  });

  test('falls back to env vars when apiKeyFile is not configured at all', () => {
    delete process.env.META_API_KEY;
    process.env.MODEL_API_KEY = 'fallback-env-value';
    try {
      assert.equal(resolveMetaApiKey(undefined, undefined), 'fallback-env-value');
    } finally {
      if (origMetaKey === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = origMetaKey;
      if (origModelKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = origModelKey;
    }
  });

  test('returns undefined when nothing is configured anywhere', () => {
    delete process.env.META_API_KEY;
    delete process.env.MODEL_API_KEY;
    try {
      assert.equal(resolveMetaApiKey(undefined, undefined), undefined);
    } finally {
      if (origMetaKey === undefined) delete process.env.META_API_KEY;
      else process.env.META_API_KEY = origMetaKey;
      if (origModelKey === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = origModelKey;
    }
  });
});

describe('resolveAnthropicApiKey', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-anthropic-key-test-'));
  const origKey = process.env.ANTHROPIC_API_KEY;

  test('apiKeyFile wins over ANTHROPIC_API_KEY when both are set', () => {
    process.env.ANTHROPIC_API_KEY = 'env-value-should-not-win';
    const file = path.join(tmpDir, 'anthropic-key');
    fs.writeFileSync(file, 'file-value\n', { mode: 0o600 });
    try {
      assert.equal(resolveAnthropicApiKey(file), 'file-value');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test('throws when apiKeyFile is configured but broken', () => {
    const missingFile = path.join(tmpDir, 'does-not-exist');
    assert.throws(() => resolveAnthropicApiKey(missingFile), /key file not found/);
  });

  test('falls back to ANTHROPIC_API_KEY when apiKeyFile is not configured', () => {
    process.env.ANTHROPIC_API_KEY = 'env-fallback';
    try {
      assert.equal(resolveAnthropicApiKey(undefined), 'env-fallback');
    } finally {
      if (origKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});

describe('expandQuery warning propagation', () => {
  test('ExpandedQueries type carries an optional warning field', () => {
    const withWarning: ExpandedQueries = {
      variants: [],
      latencyMs: 10,
      provider: 'bedrock/haiku',
      warning: 'Meta expansion: key file not found: /tmp/missing'
    };
    assert.equal(withWarning.warning?.includes('key file not found'), true);
  });
});
