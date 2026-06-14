#!/usr/bin/env node
/**
 * fetch-model — pre-download the Transformers.js embedding model into a portable
 * bundle, so it works on networks that block Hugging Face (the whole point: run
 * this ONCE on an unblocked network — home WiFi, hotspot, a CI box — then ship or
 * copy the output dir to the blocked machine).
 *
 * Usage:
 *   pnpm fetch-model                      # → ./models  (default)
 *   pnpm fetch-model --out /path/to/dir   # custom bundle dir
 *   pnpm fetch-model --host https://hf-mirror.com   # via a mirror
 *
 * Afterwards, set in plugin.json:
 *   embedding.transformers.localModelPath: "<out dir>"
 * and the Transformers.js provider loads fully offline.
 *
 * Implementation: point transformers.js's cacheDir at the bundle dir and run a
 * real pipeline load — that downloads exactly the files (config, tokenizer,
 * quantized ONNX) the runtime needs, in the layout it expects. No guessing at
 * the file list.
 */

import path from 'path';
import { env, pipeline } from '@xenova/transformers';
import { loadConfig } from '../lib/config.js';

function parseArgs(argv: string[]): { out: string; host?: string } {
  let out = './models';
  let host: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = argv[++i];
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i];
  }
  return { out: path.resolve(out), host };
}

async function main(): Promise<void> {
  const { out, host } = parseArgs(process.argv.slice(2));
  const { model } = loadConfig().embedding;

  // Force a network download into the bundle dir, regardless of deployed config.
  env.allowRemoteModels = true;
  env.allowLocalModels = false; // don't short-circuit on a partial local copy
  env.cacheDir = out;
  if (host) env.remoteHost = host;

  console.log(`fetch-model`);
  console.log(`  model: ${model}`);
  console.log(`  host:  ${env.remoteHost}`);
  console.log(`  out:   ${out}`);
  if (!process.env.NODE_EXTRA_CA_CERTS) {
    console.log(
      `  note:  on a TLS-intercepting proxy, set NODE_EXTRA_CA_CERTS to your corp CA bundle.`
    );
  }
  console.log(`\nDownloading (~140MB, first run only)…`);

  try {
    const pipe = await pipeline('feature-extraction', model, { quantized: true });
    const out0 = await pipe('search_document: bundle verification', {
      pooling: 'mean',
      normalize: true,
    });
    console.log(`\n✓ Downloaded and verified (${out0.data.length}-dim).`);
    console.log(`\nNext: set this in plugin.json so the blocked machine loads offline —`);
    console.log(`  "embedding": { "transformers": { "localModelPath": "${out}" } }`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Download failed: ${msg}`);
    if (/fetch|JSON|Unexpected token|certificate/i.test(msg)) {
      console.error(
        `\nThis network can't reach ${env.remoteHost}. Try one of:\n` +
          `  - run on a different network (home WiFi, phone hotspot)\n` +
          `  - --host <internal HF mirror URL>\n` +
          `  - NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem (TLS interception)`
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('fetch-model error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
