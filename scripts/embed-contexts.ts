#!/usr/bin/env node
/**
 * embed-contexts — build the LanceDB corpus from `.claude/context/`.
 *
 * Phase 1 scope (IMPLEMENTATION_ESTIMATE):
 *   - scan the project's `.claude/context/` markdown files
 *   - WHOLE-DOC embed (chunking is deferred to v2 — one row per file)
 *   - persist `type` (feeds the re-ranker) + `tags` (stored, inert until v2 CAE)
 *   - reject files whose filename category prefix disagrees with `metadata.type`
 *   - record provider + model + dimensions in the table sidecar (provenance)
 *
 * This rebuilds the table from scratch every run — at <200 docs that's seconds,
 * and it keeps the corpus a pure function of the files on disk. Incremental
 * re-embed (mergeInsert on file change) lands in Phase 3.
 *
 * Embedding text vs stored text: we EMBED `name + description + body` (the
 * frontmatter title/description are strong topical signal) but STORE the body as
 * `document` (that's what gets injected later). Document side gets the nomic
 * `search_document:` prefix automatically (see lib/embedder).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig, resolveDBPath } from '../lib/config.js';
import {
  findPrefixTypeMismatches,
  loadContexts,
  type LoadedContext,
} from '../lib/context-loader.js';
import { embedDocuments } from '../lib/embedder.js';
import { createTable, type ContextRow } from '../lib/lance-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Walk up from this file until a `.claude/context` dir is found (src or dist). */
function contextDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, '.claude', 'context');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  // fall back to cwd-relative if the walk fails
  return path.resolve(process.cwd(), '.claude', 'context');
}

/** Compose the text that gets embedded (richer than the stored body). */
function embedText(c: LoadedContext): string {
  return [c.name, c.description, c.content].filter(Boolean).join('\n\n');
}

async function main(): Promise<void> {
  const dir = contextDir();
  const cfg = loadConfig();
  const { provider, model, ollamaModel } = cfg.embedding;
  const modelId = provider === 'ollama' ? ollamaModel : model;

  console.log(`contextus embed`);
  console.log(`  source:   ${dir}`);
  console.log(`  provider: ${provider} (${modelId}, ${cfg.embedding.dimensions}d)`);
  console.log(`  target:   ${resolveDBPath()}`);

  const contexts = await loadContexts(dir);
  if (contexts.length === 0) {
    console.error(`\n✗ No context files found under ${dir}`);
    process.exit(1);
  }

  // Corpus hygiene: reject prefix↔type disagreements before embedding anything.
  const mismatches = findPrefixTypeMismatches(contexts);
  if (mismatches.length > 0) {
    console.error(`\n✗ Prefix/type mismatches (fix the filename prefix or metadata.type):`);
    for (const m of mismatches) {
      console.error(`    ${m.relPath}: prefix '${m.prefix}-' but type '${m.type}'`);
    }
    process.exit(1);
  }

  console.log(`\nEmbedding ${contexts.length} files…`);
  const vectors = await embedDocuments(contexts.map(embedText), (done, total) =>
    process.stdout.write(`\r  ${done}/${total}`)
  );
  process.stdout.write('\n');

  const now = new Date().toISOString();
  const rows: ContextRow[] = contexts.map((c, i) => ({
    id: c.id,
    vector: vectors[i],
    document: c.content,
    filename: c.relPath,
    type: c.type,
    tags: c.tags.join(','),
    hit_count: 0,
    last_hit: '',
    updated_at: now,
  }));

  await createTable(rows, { replace: true });

  // Summary: counts by type so the corpus shape is visible at a glance.
  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  console.log(`\n✓ Embedded ${rows.length} rows into '${resolveDBPath()}'`);
  console.log(`  by type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(', ')}`);
  const tagged = rows.filter((r) => r.tags.length > 0).length;
  console.log(`  ${tagged}/${rows.length} files carry tags`);
}

main().catch((err) => {
  console.error('\n✗ embed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
