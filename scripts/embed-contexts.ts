#!/usr/bin/env node
/**
 * embed-contexts — full rebuild of the LanceDB corpus from ALL enabled sources.
 *
 * Scope (Phase 1 base + Phase 6 multi-source/chunking):
 *   - resolve every ENABLED plugin.json source (projectContext + docs + user packs)
 *   - CHUNK each file (lib/chunker via file-to-rows) — one row per chunk, so long
 *     docs fit the embedding model's context window (nomic caps at 2048 tokens;
 *     whole-doc embedding hard-errored on DESIGN.md — Phase 6)
 *   - stamp `source` (re-ranker SOURCE_WEIGHTS), `type`, `tags`, per-chunk heading
 *   - reject context files whose filename prefix disagrees with `metadata.type`
 *     (docs are exempt — free-form, no category prefix)
 *   - record provider + model + dimensions in the table sidecar (provenance)
 *
 * Rebuilds the table from scratch every run — keeps the corpus a pure function of
 * the files on disk. The daemon's incremental path (embed-file / reconcile) handles
 * ONLY `.claude/context/`; doc/user packs refresh here, on a deliberate full embed
 * (they change slower and are noisier — see lib/embedding/sources.ts).
 *
 * Embedding text vs stored text: the first chunk EMBEDS `name + description + body`
 * (frontmatter is strong topical signal); later chunks embed their own text. The
 * STORED `document` is always the chunk body (what gets injected). Document side
 * gets the nomic `search_document:` prefix automatically (see lib/embedder).
 */

import { loadConfig, resolveDBPath, findPluginConfig, projectHash } from '../lib/config.js';
import { findPrefixTypeMismatches } from '../lib/embedding/context-loader.js';
import { resolveSources, loadAllSources } from '../lib/embedding/sources.js';
import { embedDocuments } from '../lib/embedding/embedder.js';
import { createTable, type ContextRow } from '../lib/storage/lance-client.js';
import { planChunks, buildRows, type PendingChunk } from '../lib/embedding/file-to-rows.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const pluginCfg = findPluginConfig();
  const { provider, model, ollamaModel } = cfg.embedding;
  const modelId = provider === 'ollama' ? ollamaModel : model;

  // Resolve every ENABLED source from plugin.json (projectContext + docs + user
  // packs), each relative to the project root (process.cwd()). The daemon's
  // incremental path stays context-only; doc sources refresh here, on a full
  // rebuild — matching their slower-changing, noisier nature.
  // Unified DB: project identity is a hash of the absolute path.
  const projectId = projectHash(process.cwd());
  const sources = resolveSources(pluginCfg);
  if (sources.length === 0) {
    console.error(`\n✗ No enabled sources resolved from plugin.json config.sources`);
    process.exit(1);
  }

  console.log(`contextus embed`);
  console.log(`  sources:  ${sources.map((s) => `${s.name}(${s.dir})`).join(', ')}`);
  console.log(`  provider: ${provider} (${modelId}, ${cfg.embedding.dimensions}d)`);
  console.log(`  target:   ${resolveDBPath()}`);

  const sourced = await loadAllSources(sources);
  if (sourced.length === 0) {
    console.error(`\n✗ No markdown files found across enabled sources`);
    process.exit(1);
  }

  // Corpus hygiene: prefix↔type disagreements can't embed (the gate would store a
  // row whose type contradicts its filename). QUARANTINE them — skip the bad files,
  // embed the rest, and report loudly — rather than aborting the WHOLE embed over one
  // malformed file (a single bad file used to embed nothing; observed 2026-06-15 with
  // a stray `type: pattern`). Only context-style files carry prefixes; docs are exempt.
  const mismatches = findPrefixTypeMismatches(
    sourced
      .filter((s) => s.source === 'projectContext' || s.source === 'userContext')
      .map((s) => s.context)
  );
  if (mismatches.length > 0) {
    const badPaths = new Set(mismatches.map((m) => m.relPath));
    console.error(
      `\n⚠ Skipping ${mismatches.length} file(s) with prefix/type mismatch (fix the filename prefix or metadata.type):`
    );
    for (const m of mismatches) {
      console.error(`    ${m.relPath}: prefix '${m.prefix}-' but type '${m.type}'`);
    }
    console.error(`  → embedding the rest; these won't inject until fixed.\n`);
    // Drop the bad files from the embed set (match on the context's relPath).
    for (let i = sourced.length - 1; i >= 0; i--) {
      if (badPaths.has(sourced[i].context.relPath)) sourced.splice(i, 1);
    }
    if (sourced.length === 0) {
      console.error('✗ No embeddable files remain after quarantine.');
      process.exit(1);
    }
  }

  // Plan chunks per file. `.claude/context/` keeps its bare id so it matches the
  // incremental embed-file path; other sources are id-prefixed with the source so
  // two sources can hold a same-named file without an id collision.
  const now = new Date().toISOString();
  const allRows: ContextRow[] = [];
  const allEmbedTexts: string[] = [];
  const planned: {
    pending: PendingChunk[];
    ctx: (typeof sourced)[number]['context'];
    source: string;
  }[] = [];

  for (const s of sourced) {
    if (s.source !== 'projectContext') s.context.id = `${s.source}:${s.context.id}`;
    const pending = planChunks(s.context);
    planned.push({ pending, ctx: s.context, source: s.source });
    for (const p of pending) allEmbedTexts.push(p.embedText);
  }

  const totalChunks = allEmbedTexts.length;
  console.log(`\nEmbedding ${totalChunks} chunks from ${sourced.length} files…`);
  const vectors = await embedDocuments(allEmbedTexts, (done, total) =>
    process.stdout.write(`\r  ${done}/${total}`)
  );
  process.stdout.write('\n');

  // Slice the flat vector array back per file and assemble rows.
  // User-scoped sources (userContext, userDocs) get stamped '__user__' so they're
  // visible to all projects via resolveProjectScope() which always includes '__user__'.
  let cursor = 0;
  for (const { pending, ctx, source } of planned) {
    const slice = vectors.slice(cursor, cursor + pending.length);
    cursor += pending.length;
    const rowProject = source === 'userContext' || source === 'userDocs' ? '__user__' : projectId;
    allRows.push(...buildRows(ctx, pending, slice, source, now, rowProject));
  }

  if (allRows.length === 0) {
    console.error('\n✗ No embeddable chunks produced');
    process.exit(1);
  }
  await createTable(allRows, { replace: true });

  // Summary: counts by source + type so the corpus shape is visible at a glance.
  const bySource = new Map<string, number>();
  for (const r of allRows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
  const byType = new Map<string, number>();
  for (const r of allRows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
  const files = new Set(allRows.map((r) => r.filename)).size;
  console.log(`\n✓ Embedded ${allRows.length} chunks (${files} files) into '${resolveDBPath()}'`);
  console.log(`  by source: ${[...bySource].map(([s, n]) => `${s}=${n}`).join(', ')}`);
  console.log(`  by type:   ${[...byType].map(([t, n]) => `${t}=${n}`).join(', ')}`);
}

main().catch((err) => {
  console.error('\n✗ embed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
