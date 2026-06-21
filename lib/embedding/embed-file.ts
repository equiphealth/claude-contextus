/**
 * Incremental single-file embed — the unit of work behind the daemon's /notify.
 *
 * Phase 1's embed-contexts.ts rebuilds the whole table; this re-embeds ONE file
 * and upserts it by id (mergeInsert), so editing a context file doesn't trigger a
 * full rebuild. Shared by the daemon (/notify) now and Phase 3's file watcher
 * later. Embedding text and stored body match embed-contexts exactly so an
 * incremental row is identical to a full-rebuild row.
 */

import fs from 'fs';
import path from 'path';
import { loadContext, categoryPrefix } from './context-loader.js';
import { embedDocument } from './embedder.js';
import { upsertRows, deleteByFilename, getContentHashes } from '../storage/lance-client.js';
import { isStale } from '../storage/staleness.js';
import { planChunks, buildRows } from './file-to-rows.js';

/** Outcome of an incremental embed attempt. */
export interface EmbedFileResult {
  /** false when the file wasn't re-embedded — either not indexable or unchanged */
  embedded: boolean;
  /** the row id (relative path) when embedded (or skipped-as-unchanged) */
  id?: string;
  /** why it was skipped, when embedded is false */
  reason?: string;
}

/**
 * Re-embed a single context file and upsert it into the project table.
 * `absFile` is the changed file; `contextDir` is the project's `.claude/context`.
 * `source` identifies the source label for reranking (default: projectContext).
 * `projectId` is the sha256 hash stamped on rows (unified DB).
 * Returns `embedded: false` (no throw) when the file is outside the context dir,
 * missing, or fails the prefix↔type gate — those are skips, not failures.
 */
export async function embedSingleFile(
  absFile: string,
  contextDir: string,
  projectName?: string,
  source = 'projectContext',
  projectId = ''
): Promise<EmbedFileResult> {
  const normFile = path.resolve(absFile);
  const normDir = path.resolve(contextDir);
  if (!normFile.startsWith(normDir + path.sep)) {
    return { embedded: false, reason: 'outside_context_dir' };
  }
  if (!normFile.endsWith('.md')) {
    return { embedded: false, reason: 'not_a_markdown_file' };
  }
  // File deleted: remove its rows from the corpus (orphan cleanup).
  if (!fs.existsSync(normFile)) {
    const relPath = path.relative(normDir, normFile).replace(/\\/g, '/');
    const stored = (await getContentHashes(projectName, source)).get(relPath);
    if (stored !== undefined) {
      await deleteByFilename(relPath, projectName);
      return { embedded: false, id: relPath, reason: 'deleted' };
    }
    return { embedded: false, reason: 'not_found' };
  }
  const base = path.basename(normFile);
  if (base === 'CONTEXT.md' || base === 'README.md') {
    return { embedded: false, reason: 'index_or_readme' };
  }

  const ctx = loadContext(normFile, normDir);
  // Honor the same prefix↔type hygiene gate as the full build.
  const prefix = categoryPrefix(ctx.relPath);
  if (prefix && ctx.type !== 'unknown' && ctx.type !== prefix) {
    return { embedded: false, reason: `prefix_type_mismatch (${prefix} vs ${ctx.type})` };
  }

  // Staleness gate: a save that didn't change the body shouldn't pay for a
  // re-embed. Compare the new content hash against the stored (file-level) one.
  const stored = (await getContentHashes(projectName, source)).get(ctx.relPath);
  if (!isStale(stored, ctx.content)) {
    return { embedded: false, id: ctx.id, reason: 'unchanged' };
  }

  // Chunk → embed each chunk → replace the file's prior chunks. We delete by
  // filename first so a file that now produces FEWER chunks doesn't leave stale
  // high-index rows behind (upsert-by-id alone wouldn't remove them).
  const pending = planChunks(ctx);
  if (pending.length === 0) return { embedded: false, id: ctx.id, reason: 'empty' };
  const vectors = [];
  for (const p of pending) vectors.push(await embedDocument(p.embedText));
  const rows = buildRows(ctx, pending, vectors, source, new Date().toISOString(), projectId);
  await deleteByFilename(ctx.relPath, projectName, projectId || undefined);
  await upsertRows(rows, projectName);
  return { embedded: true, id: ctx.id };
}
