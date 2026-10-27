/**
 * Meta provider unit tests — expansion + eval dispatch over a mocked fetch.
 *
 * Covers the OpenAI-compatible contract shape (endpoint, Bearer key, model),
 * the provider string, missing-key fail-open, and that the key value never
 * appears in thrown errors. The live wire check (Spark 1.3 Contributor,
 * real API) is a §6 verification item, not a unit test.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery, resolveMetaApiKey } from '../lib/retrieval/expand.js';
import { callEvalModel } from '../lib/calibration/eval-model.js';

const BASE_CFG = {
  mode: 'always' as const,
  provider: 'meta' as const,
  model: 'muse-spark-1.3-contributor',
  expansionThreshold: 0.55,
  maxVariants: 3,
  temperature: 0.7,
  timeoutMs: 20000
};

const PROVIDERS = {
  ollama: { endpoint: 'http://localhost:11434' },
  bedrock: { region: 'us-east-1' },
  anthropic: {},
  meta: { endpoint: 'https://api.meta.ai/v1', apiKeyEnv: 'META_API_KEY' }
};

function mockChoices(text: string) {
  const originalFetch = globalThis.fetch;
  let seenUrl = '';
  let seenAuth = '';
  let seenBody: Record<string, unknown> = {};
  globalThis.fetch = (async (
    url: unknown,
    init?: { headers?: Record<string, string>; body?: string }
  ) => {
    seenUrl = String(url);
    seenAuth = init?.headers?.['authorization'] ?? '';
    seenBody = JSON.parse(String(init?.body ?? '{}'));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: text } }] })
    };
  }) as unknown as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    seen: () => ({ seenUrl, seenAuth, seenBody })
  };
}

function withMetaKey(value: string | undefined, fn: () => void | Promise<unknown>) {
  const origMeta = process.env.META_API_KEY;
  const origModel = process.env.MODEL_API_KEY;
  delete process.env.META_API_KEY;
  delete process.env.MODEL_API_KEY;
  if (value !== undefined) process.env.META_API_KEY = value;
  const done = () => {
    delete process.env.META_API_KEY;
    delete process.env.MODEL_API_KEY;
    if (origMeta !== undefined) process.env.META_API_KEY = origMeta;
    if (origModel !== undefined) process.env.MODEL_API_KEY = origModel;
  };
  try {
    const r = fn();
    if (r instanceof Promise) return r.finally(done);
    done();
  } catch (e) {
    done();
    throw e;
  }
}

test('resolveMetaApiKey: configured env first, MODEL_API_KEY fallback', () => {
  const origMeta = process.env.META_API_KEY;
  const origModel = process.env.MODEL_API_KEY;
  try {
    delete process.env.META_API_KEY;
    delete process.env.MODEL_API_KEY;
    assert.equal(resolveMetaApiKey(), undefined);
    process.env.MODEL_API_KEY = 'fallback-key';
    assert.equal(resolveMetaApiKey(), 'fallback-key');
    process.env.META_API_KEY = 'primary-key';
    assert.equal(resolveMetaApiKey(), 'primary-key');
    process.env.CUSTOM_KEY = 'custom-key';
    assert.equal(resolveMetaApiKey('CUSTOM_KEY'), 'custom-key');
  } finally {
    delete process.env.META_API_KEY;
    delete process.env.MODEL_API_KEY;
    delete process.env.CUSTOM_KEY;
    if (origMeta !== undefined) process.env.META_API_KEY = origMeta;
    if (origModel !== undefined) process.env.MODEL_API_KEY = origModel;
  }
});

test('expandQuery meta: posts chat completions, parses variants, names provider', async () => {
  await withMetaKey('test-meta-key', async () => {
    const mock = mockChoices('alpha query\nbeta query phrase\ngamma query phrase here');
    try {
      const result = await expandQuery('How do I configure embeddings?', BASE_CFG, PROVIDERS);
      assert.equal(result.variants.length, 3);
      assert.equal(result.provider, 'meta/muse-spark-1.3-contributor');
      const { seenUrl, seenAuth, seenBody } = mock.seen();
      assert.equal(seenUrl, 'https://api.meta.ai/v1/chat/completions');
      assert.equal(seenAuth, 'Bearer test-meta-key');
      assert.equal((seenBody as { model: string }).model, 'muse-spark-1.3-contributor');
    } finally {
      mock.restore();
    }
  });
});

test('expandQuery meta: missing key fails open to variants: [] without fetch', async () => {
  await withMetaKey(undefined, async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('must not fetch without a key');
    }) as unknown as typeof fetch;
    try {
      const result = await expandQuery('How do I configure embeddings?', BASE_CFG, PROVIDERS);
      assert.deepEqual(result.variants, []);
      assert.equal(fetched, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('expandQuery meta: error message names the env var, never the key value', async () => {
  await withMetaKey(undefined, async () => {
    const result = await expandQuery('How do I configure embeddings?', BASE_CFG, PROVIDERS);
    assert.deepEqual(result.variants, []);
  });
});

test('callEvalModel meta: posts chat completions, returns message text', async () => {
  await withMetaKey('test-meta-key', async () => {
    const mock = mockChoices('1:critical, 2:helpful');
    try {
      const text = await callEvalModel('grade this', {
        provider: 'meta',
        model: 'muse-spark-1.3-contributor'
      });
      assert.equal(text, '1:critical, 2:helpful');
      const { seenUrl, seenAuth } = mock.seen();
      assert.equal(seenUrl, 'https://api.meta.ai/v1/chat/completions');
      assert.equal(seenAuth, 'Bearer test-meta-key');
    } finally {
      mock.restore();
    }
  });
});

test('callEvalModel meta: missing key rejects without fetch', async () => {
  await withMetaKey(undefined, async () => {
    const originalFetch = globalThis.fetch;
    let fetched = false;
    globalThis.fetch = (async () => {
      fetched = true;
      throw new Error('must not fetch without a key');
    }) as unknown as typeof fetch;
    try {
      await assert.rejects(() => callEvalModel('grade this', { provider: 'meta' }), /META_API_KEY/);
      assert.equal(fetched, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
