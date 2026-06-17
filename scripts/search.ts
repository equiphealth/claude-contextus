#!/usr/bin/env node
/**
 * search — query the contextus corpus from the terminal (dev/verify tool).
 *
 * Uses the exact query-side path Phase 2's daemon will use: embedQuery →
 * `search_query:` prefix → active provider → LanceDB vector search. Lets you
 * spot-check retrieval quality (and the similarity distribution that feeds the
 * Phase 5 floor) without a live Claude session or vector-inspector.
 *
 * Usage:
 *   pnpm search "how does the lancedb api work"
 *   pnpm search --k 10 "embedding model choice"
 *   pnpm search --type decision "what did we pick for the daemon port"
 */

import { embedQuery } from '../lib/embedding/embedder.js';
import { search } from '../lib/storage/lance-client.js';
import { loadConfig } from '../lib/config.js';

function parseArgs(argv: string[]): { query: string; k: number; type?: string } {
  let k = loadConfig().retrieval.topK;
  let type: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--k' && argv[i + 1]) k = Number(argv[++i]);
    else if (argv[i] === '--type' && argv[i + 1]) type = argv[++i];
    else rest.push(argv[i]);
  }
  return { query: rest.join(' ').trim(), k, type };
}

async function main(): Promise<void> {
  const { query, k, type } = parseArgs(process.argv.slice(2));
  if (!query) {
    console.error('Usage: pnpm search [--k N] [--type TYPE] "your query"');
    process.exit(1);
  }

  const cfg = loadConfig();
  const provider = cfg.embedding.provider;
  // The GATE that decides "inject anything at all?" is injectionFloor (applied by
  // the daemon's /query → applyFloor), NOT similarityThreshold (a post-rank filter).
  // Reporting similarityThreshold here made injectable hits look dead. Show the floor.
  const floor = cfg.retrieval.injectionFloor;
  console.log(
    `query:  "${query}"  (provider=${provider}, k=${k}, injectionFloor=${floor}${type ? `, type=${type}` : ''})`
  );

  const vec = await embedQuery(query);
  const results = await search(vec, k, type ? `type = '${type}'` : undefined);

  if (results.length === 0) {
    console.log('\n(no rows — is the corpus embedded? run `pnpm embed`)');
    return;
  }

  console.log('');
  for (const [i, r] of results.entries()) {
    const floorFlag =
      r.similarity < floor ? `  ⚠ below ${floor} floor (won't inject)` : '  ✓ injects';
    const snippet = r.document.replace(/\s+/g, ' ').slice(0, 100);
    console.log(`${i + 1}. ${r.similarity.toFixed(4)}  [${r.type}]  ${r.id}${floorFlag}`);
    console.log(`     ${snippet}…`);
  }
  // Distribution hint for floor calibration.
  const top = results[0].similarity;
  const wouldInject = top >= floor;
  console.log(
    `\ntop similarity: ${top.toFixed(4)} — ${wouldInject ? 'INJECTS' : 'no injection'} at injectionFloor=${floor}` +
      (wouldInject ? '' : ` (calibrate with /context-calibrate --floor for this corpus)`)
  );
}

main().catch((err) => {
  console.error('search failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
