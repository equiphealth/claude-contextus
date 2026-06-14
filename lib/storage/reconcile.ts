/**
 * Reconcile planner — decide what a cold/stale corpus needs to catch up (pure).
 *
 * First-run onboarding (IMPLEMENTATION_ESTIMATE "First-Run Onboarding",
 * first-run-onboarding memory): session-start ensures the daemon is *running* but
 * historically never checked whether the project's *corpus exists*. A fresh
 * install with a populated `.claude/context/` but no LanceDB table injects
 * nothing — silently, forever — until someone runs `pnpm run embed` by hand. For
 * a "context finds you" system that invisible cold-start is the worst trust
 * failure. This planner is the detection half: given the files on disk and the
 * hashes already in the table, it computes what to (re-)embed and what to drop.
 *
 * Pure logic, no I/O — the daemon (/reconcile) feeds in disk + table state and
 * acts on the plan, so the comparison stays trivially unit-testable. The actual
 * embed reuses embedSingleFile (idempotent, staleness-skipping), so re-running a
 * reconcile when nothing changed costs nothing.
 */

import { isStale } from './staleness.js';

/** A context file on disk, reduced to what reconcile needs. */
export interface DiskFile {
  /** stable id = path relative to the context dir (matches ContextRow.id) */
  id: string;
  /** absolute path, so the embedder can read it */
  absPath: string;
  /** trimmed body, for the staleness hash compare */
  content: string;
}

/** What a reconcile would do, before doing it. */
export interface ReconcilePlan {
  /** ids present on disk but absent from the table — never embedded */
  toEmbedNew: string[];
  /** ids whose disk content hash differs from the stored hash — changed */
  toEmbedChanged: string[];
  /** ids in the table but no longer on disk — orphan rows to remove */
  toRemove: string[];
  /** files that match the table exactly — nothing to do */
  unchanged: string[];
  /** absolute paths to embed (new + changed), in the order to process */
  embedPaths: string[];
  /**
   * Corpus state verdict:
   *  - 'missing' : no table at all (the cold-start case)
   *  - 'stale'   : table exists but lags disk (new/changed/orphan rows)
   *  - 'fresh'   : table matches disk exactly
   *  - 'empty'   : no context files on disk (nothing to reconcile)
   */
  state: 'missing' | 'stale' | 'fresh' | 'empty';
}

/**
 * Compute the reconcile plan from disk files and the table's id→hash map.
 *
 * @param diskFiles    every context file currently on disk
 * @param tableHashes  id → stored content_hash for rows already in the table
 * @param tableExists  whether the LanceDB table exists at all (drives 'missing')
 */
export function planReconcile(
  diskFiles: DiskFile[],
  tableHashes: Map<string, string>,
  tableExists: boolean
): ReconcilePlan {
  const toEmbedNew: string[] = [];
  const toEmbedChanged: string[] = [];
  const unchanged: string[] = [];
  const embedPaths: string[] = [];
  const diskIds = new Set<string>();

  for (const f of diskFiles) {
    diskIds.add(f.id);
    const stored = tableHashes.get(f.id);
    if (stored === undefined) {
      toEmbedNew.push(f.id);
      embedPaths.push(f.absPath);
    } else if (isStale(stored, f.content)) {
      toEmbedChanged.push(f.id);
      embedPaths.push(f.absPath);
    } else {
      unchanged.push(f.id);
    }
  }

  // Orphans: rows whose file is gone from disk. Reported so the daemon can drop
  // them; never blocks the embed work.
  const toRemove = [...tableHashes.keys()].filter((id) => !diskIds.has(id));

  let state: ReconcilePlan['state'];
  if (diskFiles.length === 0) state = 'empty';
  else if (!tableExists) state = 'missing';
  else if (toEmbedNew.length || toEmbedChanged.length || toRemove.length) state = 'stale';
  else state = 'fresh';

  return { toEmbedNew, toEmbedChanged, toRemove, unchanged, embedPaths, state };
}
