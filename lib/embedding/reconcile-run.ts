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

import path from 'node:path';
import { loadContexts, quarantineMismatches } from './context-loader.js';
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
  /** relPaths of files whose frontmatter YAML failed to parse this pass */
  failed: string[];
}

/**
 * Reconcile the corpus for one project against its on-disk context dir. Returns a
 * summary; throws only on a genuine embedder/storage failure (the caller logs it).
 * `projectId` is the sha256 hash stamped on rows (unified DB).
 *
 * `exclude` should be the SOURCE's own configured exclude globs (see
 * lib/embedding/sources.ts's ResolvedSource) — a doc source's `DOCS.md` needs
 * excluding the same way a context source's `CONTEXT.md` does. Omitting it
 * falls back to CONTEXT.md/README.md only, which is wrong for any other
 * source (see GH issue #22 — this is what let DOCS.md itself get embedded as
 * document content when reconcile started running for all sources).
 */
export async function runReconcile(
  contextDir: string,
  projectName?: string,
  projectId = '',
  source = 'projectContext',
  exclude?: string[],
  sourceType?: string,
  cwd?: string
): Promise<ReconcileResult> {
  const { contexts: allContexts, failed: loadFailed } = await loadContexts(contextDir, exclude);
  // Quarantine prefix/type-mismatch files: they can't embed (the gate rejects them),
  // so if reconcile kept them in the disk set planReconcile would mark them "new"
  // EVERY session — the "re-embedding 1 forever" phantom (observed 2026-06-15 with a
  // stray `type: pattern`). Drop them here so reconcile and embed agree; they simply
  // don't inject until fixed. A full `pnpm run embed` reports them loudly. Shared
  // with the daemon's check-mode twin via quarantineMismatches() — MUST stay the
  // one implementation both call, not two copies of the same guard (see its doc
  // comment for why: this exact divergence caused a real docs-file false positive).
  const { contexts } = quarantineMismatches(allContexts, sourceType);
  const exists = await tableExists(projectName);
  // Scope hash lookup to this source + projectId to avoid treating other sources' rows as orphans
  const hashes = await getContentHashes(projectName, source, projectId || undefined);

  const diskFiles: DiskFile[] = contexts.map((c) => ({
    id: c.id,
    absPath: c.absPath,
    content: c.content
  }));
  const plan = planReconcile(diskFiles, hashes, exists);

  const failed = loadFailed.map((f) => f.relPath);

  if (plan.state === 'empty' || plan.state === 'fresh') {
    return { state: plan.state, embedded: 0, removed: 0, unchanged: plan.unchanged.length, failed };
  }

  // Cold start: no table yet → chunk + build it from every file in one shot.
  if (plan.state === 'missing') {
    const now = new Date().toISOString();
    const rows: ContextRow[] = [];
    for (const c of contexts) {
      const pending = planChunks(c);
      if (pending.length === 0) continue;
      const vectors = await embedDocuments(
        pending.map((p) => p.embedText),
        undefined,
        {
          projectId,
          cwd
        }
      );
      rows.push(...buildRows(c, pending, vectors, source, now, projectId));
    }
    if (rows.length === 0)
      return { state: plan.state, embedded: 0, removed: 0, unchanged: 0, failed };
    await createTable(rows, { projectName, replace: true });
    return { state: plan.state, embedded: contexts.length, removed: 0, unchanged: 0, failed };
  }

  // Stale: incremental re-embed of new/changed files + orphan removal. embedSingleFile
  // chunks + replaces per file; orphans (files gone from disk) delete all their chunks.
  let embedded = 0;
  for (const absPath of plan.embedPaths) {
    const r = await embedSingleFile(
      absPath,
      contextDir,
      projectName,
      source,
      projectId,
      sourceType,
      cwd
    );
    if (r.embedded) embedded++;
    else if (r.reason?.startsWith('yaml_parse_error')) {
      failed.push(path.relative(contextDir, absPath).replace(/\\/g, '/'));
    }
  }
  for (const filename of plan.toRemove)
    await deleteByFilename(filename, projectName, projectId || undefined);
  return {
    state: plan.state,
    embedded,
    removed: plan.toRemove.length,
    unchanged: plan.unchanged.length,
    failed
  };
}
