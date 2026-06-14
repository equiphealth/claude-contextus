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
import { upsertRows, getContentHashes, type ContextRow } from '../storage/lance-client.js';
import { contentHash, isStale } from '../storage/staleness.js';

/** Compose the embedded text (richer than the stored body) — mirrors embed-contexts. */
function embedText(name: string, description: string, content: string): string {
  return [name, description, content].filter(Boolean).join('\n\n');
}

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
 * Returns `embedded: false` (no throw) when the file is outside the context dir,
 * missing, or fails the prefix↔type gate — those are skips, not failures.
 */
export async function embedSingleFile(
  absFile: string,
  contextDir: string,
  projectName?: string
): Promise<EmbedFileResult> {
  const normFile = path.resolve(absFile);
  const normDir = path.resolve(contextDir);
  if (!normFile.startsWith(normDir + path.sep)) {
    return { embedded: false, reason: 'outside_context_dir' };
  }
  if (!fs.existsSync(normFile) || !normFile.endsWith('.md')) {
    return { embedded: false, reason: 'not_a_markdown_file' };
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
  // re-embed. Compare the new content hash against the stored one.
  const hash = contentHash(ctx.content);
  const stored = (await getContentHashes(projectName)).get(ctx.id);
  if (!isStale(stored, ctx.content)) {
    return { embedded: false, id: ctx.id, reason: 'unchanged' };
  }

  const vector = await embedDocument(embedText(ctx.name, ctx.description, ctx.content));
  const row: ContextRow = {
    id: ctx.id,
    vector,
    document: ctx.content,
    filename: ctx.relPath,
    type: ctx.type,
    tags: ctx.tags.join(','),
    hit_count: 0,
    last_hit: '',
    updated_at: new Date().toISOString(),
    content_hash: hash,
  };
  await upsertRows([row], projectName);
  return { embedded: true, id: ctx.id };
}
