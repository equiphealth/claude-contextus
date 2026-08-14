/**
 * MANUAL, TEMPORARY verification — NOT wired into `pnpm test` or
 * `pnpm test:integration` (both glob `tests/*.test.ts` /
 * `tests/integration/*.test.ts`; this file lives in `tests/manual/`, matching
 * neither). Never run in CI.
 *
 * Purpose: the `transformers` embedding provider (tradeoffs/tradeoff-
 * embedding-provider-deployment.md) is real, documented, and shipped as an
 * option, but nothing in the automated suite ever actually exercises
 * contextus's OWN code for it — Ollama is the only provider CI can test
 * without a huggingface.co download. This drives `lib/embedding/embedder.ts`
 * (`embedDocument`/`embedQuery`/`warmup`) and `model-resolver.ts`
 * (`configureTransformersEnv`/`preflightTransformers`/`hasLocalModel`)
 * exactly as the daemon would — not the raw `@xenova/transformers` API
 * directly — using a local model bundle instead of hitting the network.
 *
 * Setup (one-time, not automated — this test SKIPS itself if the bundle isn't
 * present rather than failing, so it's safe to leave in the repo for anyone
 * who doesn't have the bundle):
 *
 *   mkdir -p assets/model/nomic-ai/nomic-embed-text-v1.5/onnx
 *   cd assets/model/nomic-ai/nomic-embed-text-v1.5
 *   unzip -o ../../../model.zip \
 *     config.json config_sentence_transformers.json modules.json \
 *     1_Pooling/config.json sentence_bert_config.json special_tokens_map.json \
 *     tokenizer.json tokenizer_config.json vocab.txt onnx/model_quantized.onnx \
 *     -d .
 *
 * (Only the quantized ONNX variant is extracted — the zip also contains
 * fp16/int8/q4/bnb4/uint8 variants and the raw safetensors checkpoint, ~2GB
 * combined, none of which the default `quantized: true` pipeline load uses.)
 *
 * `assets/model.zip` and `assets/model/` are both gitignored — this is a
 * local-only fixture, never committed.
 *
 * Run directly (not via `pnpm test`):
 *   node --import tsx --test tests/manual/transformers-local-model.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';
const MODEL_DIR = path.resolve(process.cwd(), 'assets/model');
const MODEL_CONFIG = path.join(MODEL_DIR, MODEL_ID, 'config.json');

const bundlePresent = fs.existsSync(MODEL_CONFIG);

test("transformers provider: contextus's own embedder/model-resolver code, real offline inference", async (t) => {
  if (!bundlePresent) {
    t.skip(`no local model bundle at ${MODEL_CONFIG} — see file header for setup steps`);
    return;
  }

  // Point contextus's OWN config loader at a throwaway plugin.json instead of
  // the real one, so this exercises loadConfig() -> configureTransformersEnv()
  // -> pipeline() exactly as the daemon does, not a hand-rolled env setup that
  // could pass even if the real wiring were broken.
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-plugin-'));
  fs.writeFileSync(
    path.join(pluginRoot, 'plugin.json'),
    JSON.stringify({
      embedding: {
        provider: 'transformers',
        model: MODEL_ID,
        dimensions: 768,
        transformers: {
          localModelPath: MODEL_DIR,
          allowRemoteModels: false
        }
      }
    })
  );
  const prevPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;

  const { resetConfigCache } = await import('../../lib/config.js');
  const { resetResolver } = await import('../../lib/embedding/model-resolver.js');
  const { resetEmbedder, embedDocument, embedQuery, warmup } =
    await import('../../lib/embedding/embedder.js');
  resetConfigCache();
  resetResolver();
  resetEmbedder();

  try {
    // warmup() is the real code path the daemon calls at startup — exercises
    // preflightTransformers (hasLocalModel check) + the dimension-match guard,
    // not just "does pipeline() not throw".
    await warmup();

    const dogVec = await embedDocument('A dog is a loyal companion animal.');
    const puppyVec = await embedDocument('A puppy is a young dog.');
    const spreadsheetVec = await embedDocument('Quarterly revenue projections spreadsheet.');
    const queryVec = await embedQuery('what pets are loyal');

    // Real inference, not a stub — 768-dim as configured, and not degenerate
    // (all-zero/NaN would pass a length check but mean the model silently
    // failed to load real weights).
    for (const vec of [dogVec, puppyVec, spreadsheetVec, queryVec]) {
      assert.equal(vec.length, 768);
      assert.ok(
        vec.some((x) => x !== 0),
        'embedding must not be all-zero'
      );
      assert.ok(
        vec.every((x) => Number.isFinite(x)),
        'embedding must not contain NaN/Infinity'
      );
    }

    const cosine = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0);
    const dogPuppySim = cosine(dogVec, puppyVec);
    const dogSpreadsheetSim = cosine(dogVec, spreadsheetVec);
    const queryDogSim = cosine(queryVec, dogVec);
    const querySpreadsheetSim = cosine(queryVec, spreadsheetVec);

    console.log(`dog~puppy similarity:          ${dogPuppySim.toFixed(4)}`);
    console.log(`dog~spreadsheet similarity:    ${dogSpreadsheetSim.toFixed(4)}`);
    console.log(`query~dog similarity:          ${queryDogSim.toFixed(4)}`);
    console.log(`query~spreadsheet similarity:  ${querySpreadsheetSim.toFixed(4)}`);

    // Semantic sanity, not just "it ran": related content should clearly beat
    // unrelated content, on both the document-document and the asymmetric
    // query-document (search_query:/search_document: prefixed) paths that
    // embedDocument/embedQuery apply — proving the real prefixing logic in
    // embedder.ts is exercised, not bypassed.
    assert.ok(
      dogPuppySim > dogSpreadsheetSim + 0.1,
      `expected dog~puppy (${dogPuppySim.toFixed(4)}) to clearly beat dog~spreadsheet (${dogSpreadsheetSim.toFixed(4)})`
    );
    assert.ok(
      queryDogSim > querySpreadsheetSim + 0.1,
      `expected query~dog (${queryDogSim.toFixed(4)}) to clearly beat query~spreadsheet (${querySpreadsheetSim.toFixed(4)})`
    );
  } finally {
    if (prevPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = prevPluginRoot;
    resetConfigCache();
    resetResolver();
    resetEmbedder();
    fs.rmSync(pluginRoot, { recursive: true, force: true });
  }
});
