/**
 * file → rows — the single chunk-and-embed transform shared by every ingest path.
 *
 * v1 originally embedded whole-doc (one row per file). That broke the moment docs
 * were wired in: nomic-embed-text caps at 2048 tokens and Ollama hard-errors on
 * overflow (it doesn't truncate). So ingest now CHUNKS each file (lib/chunker) and
 * emits one row per chunk. Centralized here so the full rebuild (embed-contexts),
 * the incremental re-embed (embed-file), and the reconcile bootstrap all produce
 * IDENTICAL rows — divergence between them was the Phase-1/3 footgun this avoids.
 *
 * Row identity:
 *   - id           = `${fileId}#${chunkIndex}` — unique per chunk, stable across
 *                    re-embeds (chunk order is deterministic for unchanged text).
 *   - filename     = the file's source-relative path, SHARED by its chunks, so the
 *                    formatter can dedupe multiple chunks of one file under one
 *                    heading.
 *   - content_hash = the FILE's hash (same for every chunk of a file), so the
 *                    staleness gate is per-file: unchanged file → skip all chunks.
 */

import { chunkMarkdown, DEFAULT_CHUNK_OPTIONS } from './chunker.js';
import { contentHash } from '../storage/staleness.js';
import type { LoadedContext } from './context-loader.js';
import type { ContextRow } from '../storage/lance-client.js';

/** A chunk's text plus the metadata needed to build its row (pre-embedding). */
export interface PendingChunk {
  /** row id `${fileId}#${index}` */
  id: string;
  /** text to EMBED (richer than the stored body — includes name/description on c0) */
  embedText: string;
  /** text to STORE + inject (the chunk body) */
  document: string;
  chunkIndex: number;
  heading: string;
}

/**
 * Split a loaded file into pending chunks. The FIRST chunk is prepended with the
 * file's name + description (strong topical signal, mirrors the old whole-doc
 * embedText); later chunks embed their own text. Chunk size stays under the
 * embedding model's context window (DEFAULT_CHUNK_OPTIONS.maxTokens = 512 ≪ 2048).
 */
export function planChunks(ctx: LoadedContext): PendingChunk[] {
  const chunks = chunkMarkdown(ctx.content, DEFAULT_CHUNK_OPTIONS);
  // A file with no body still deserves one row (its name/description carry signal).
  if (chunks.length === 0) {
    const head = [ctx.name, ctx.description].filter(Boolean).join('\n\n');
    if (!head.trim()) return [];
    return [
      { id: `${ctx.id}#0`, embedText: head, document: ctx.content, chunkIndex: 0, heading: '' }
    ];
  }
  return chunks.map((c) => {
    const embedText =
      c.index === 0 ? [ctx.name, ctx.description, c.text].filter(Boolean).join('\n\n') : c.text;
    return {
      id: `${ctx.id}#${c.index}`,
      embedText,
      document: c.text,
      chunkIndex: c.index,
      heading: c.heading
    };
  });
}

/** Assemble full rows from pending chunks + their embedding vectors + metadata. */
export function buildRows(
  ctx: LoadedContext,
  pending: PendingChunk[],
  vectors: number[][],
  source: string,
  now: string,
  project = ''
): ContextRow[] {
  const hash = contentHash(ctx.content);
  return pending.map((p, i) => ({
    id: project ? `${project}:${p.id}` : p.id,
    project,
    vector: vectors[i],
    document: p.document,
    filename: ctx.relPath,
    chunk_index: p.chunkIndex,
    heading: p.heading,
    type: ctx.type,
    source,
    tags: ctx.tags.join(','),
    hit_count: 0,
    last_hit: '',
    updated_at: now,
    content_hash: hash
  }));
}
