/**
 * Reconcile runner — bring a project's corpus in line with `.claude/context/`.
 *
 * The daemon's /reconcile calls this in the BACKGROUND (first-run-onboarding):
 * session-start detects a cold/stale corpus and fires it off without blocking the
 * session-start window. It's the action half; the pure decision half is
 * lib/storage/reconcile.ts (planReconcile).
 *
 * Two paths, picked by the plan's `state`:
 *   - 'missing' → full createTable bootstrap (can't mergeInsert into a table that
 *     doesn't exist yet — the cold-start case).
 *   - 'stale'   → incremental: re-embed new/changed files (embedSingleFile, which
 *     itself skips unchanged content) + drop orphan rows.
 * 'fresh'/'empty' do nothing — idempotent, so a reconcile when nothing changed is
 * effectively free (the Phase-3 staleness skip is what makes this cheap to fire
 * automatically every session).
 */

import { loadContexts, findPrefixTypeMismatches } from './context-loader.js';
import { embedDocuments } from './embedder.js';
import { embedSingleFile } from './embed-file.js';
import { planChunks, buildRows } from './file-to-rows.js';
import { planReconcile, type DiskFile, type ReconcilePlan } from '../storage/reconcile.js';
import {
  createTable,
  deleteByFilename,
  getContentHashes,
  tableExists,
  type ContextRow
} from '../storage/lance-client.js';

/** Outcome of a reconcile, for logging + the session-start systemMessage. */
export interface ReconcileResult {
  state: ReconcilePlan['state'];
  embedded: number;
  removed: number;
  unchanged: number;
}

/**
 * Reconcile the corpus for one project against its on-disk context dir. Returns a
 * summary; throws only on a genuine embedder/storage failure (the caller logs it).
 * `projectId` is the sha256 hash stamped on rows (unified DB).
 */
export async function runReconcile(
  contextDir: string,
  projectName?: string,
  projectId = ''
): Promise<ReconcileResult> {
  const allContexts = await loadContexts(contextDir);
  // Quarantine prefix/type-mismatch files: they can't embed (the gate rejects them),
  // so if reconcile kept them in the disk set planReconcile would mark them "new"
  // EVERY session — the "re-embedding 1 forever" phantom (observed 2026-06-15 with a
  // stray `type: pattern`). Drop them here so reconcile and embed agree; they simply
  // don't inject until fixed. A full `pnpm run embed` reports them loudly.
  const badPaths = new Set(findPrefixTypeMismatches(allContexts).map((m) => m.relPath));
  const contexts = allContexts.filter((c) => !badPaths.has(c.relPath));
  const exists = await tableExists(projectName);
  // Reconcile manages ONLY the projectContext source — doc/user packs refresh on a
  // full `pnpm run embed`, so scoping the hash map keeps reconcile from seeing
  // them as orphans to delete. Also scoped to this project's rows in the unified DB.
  const hashes = await getContentHashes(projectName, 'projectContext', projectId || undefined);

  const diskFiles: DiskFile[] = contexts.map((c) => ({
    id: c.id,
    absPath: c.absPath,
    content: c.content
  }));
  const plan = planReconcile(diskFiles, hashes, exists);

  if (plan.state === 'empty' || plan.state === 'fresh') {
    return { state: plan.state, embedded: 0, removed: 0, unchanged: plan.unchanged.length };
  }

  // Cold start: no table yet → chunk + build it from every file in one shot.
  if (plan.state === 'missing') {
    const now = new Date().toISOString();
    const rows: ContextRow[] = [];
    for (const c of contexts) {
      const pending = planChunks(c);
      if (pending.length === 0) continue;
      const vectors = await embedDocuments(pending.map((p) => p.embedText));
      rows.push(...buildRows(c, pending, vectors, 'projectContext', now, projectId));
    }
    if (rows.length === 0) return { state: plan.state, embedded: 0, removed: 0, unchanged: 0 };
    await createTable(rows, { projectName, replace: true });
    return { state: plan.state, embedded: contexts.length, removed: 0, unchanged: 0 };
  }

  // Stale: incremental re-embed of new/changed files + orphan removal. embedSingleFile
  // chunks + replaces per file; orphans (files gone from disk) delete all their chunks.
  let embedded = 0;
  for (const absPath of plan.embedPaths) {
    const r = await embedSingleFile(absPath, contextDir, projectName, 'projectContext', projectId);
    if (r.embedded) embedded++;
  }
  for (const filename of plan.toRemove)
    await deleteByFilename(filename, projectName, projectId || undefined);
  return {
    state: plan.state,
    embedded,
    removed: plan.toRemove.length,
    unchanged: plan.unchanged.length
  };
}
