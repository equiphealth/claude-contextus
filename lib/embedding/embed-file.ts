/**
 * Incremental single-file embed — the unit of work behind the daemon's /notify.
 *
 * Phase 1's embed-contexts.ts rebuilds the whole table; this re-embeds ONE file
 * and upserts it by id (mergeInsert), so editing a context file doesn't trigger a
 * full rebuild. Shared by the daemon (/notify) now and Phase 3's file watcher
 * later. Embedding text and stored body match embed-contexts exactly so an
 * incremental row is identical to a full-rebuild row.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  loadContextSafe,
  isLoadFailure,
  categoryPrefix,
  quarantineMismatches
} from './context-loader.js';
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
  projectId = '',
  sourceType?: string
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
    const stored = (await getContentHashes(projectName, source, projectId || undefined)).get(
      relPath
    );
    if (stored !== undefined) {
      await deleteByFilename(relPath, projectName, projectId || undefined);
      return { embedded: false, id: relPath, reason: 'deleted' };
    }
    return { embedded: false, reason: 'not_found' };
  }
  // Known generated-index filenames across every source type. This is a
  // basename-only safety net for the single-file path (/notify, the fs.watch
  // watcher) — the bulk reconcile/embed paths use each source's own configured
  // `exclude` globs (see lib/embedding/sources.ts, context-loader.ts's
  // loadContexts). Before DOCS.md was added here, editing a projectDocs
  // source's own index file directly would get it embedded as real document
  // content via this exact path (GH issue #22).
  const base = path.basename(normFile);
  if (base === 'CONTEXT.md' || base === 'DOCS.md' || base === 'README.md') {
    return { embedded: false, reason: 'index_or_readme' };
  }

  const loaded = loadContextSafe(normFile, normDir);
  if (isLoadFailure(loaded)) {
    return { embedded: false, reason: `yaml_parse_error: ${loaded.error}` };
  }
  const ctx = loaded;
  // Honor the same prefix↔type hygiene gate as the full build -- via the one
  // shared quarantineMismatches() every embed/reconcile path now calls, so a
  // doc source is exempt here exactly the same way it is everywhere else (this
  // was its own independent, diverged copy of the guard until caught in review
  // on PR #65 -- fourth occurrence of the same bug class).
  if (quarantineMismatches([ctx], sourceType).contexts.length === 0) {
    const prefix = categoryPrefix(ctx.relPath);
    return { embedded: false, reason: `prefix_type_mismatch (${prefix} vs ${ctx.type})` };
  }

  // Staleness gate: a save that didn't change the body shouldn't pay for a
  // re-embed. Compare the new content hash against the stored (file-level) one.
  const stored = (await getContentHashes(projectName, source, projectId || undefined)).get(
    ctx.relPath
  );
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
