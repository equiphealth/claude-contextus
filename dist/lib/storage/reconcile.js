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
/**
 * Compute the reconcile plan from disk files and the table's id→hash map.
 *
 * @param diskFiles    every context file currently on disk
 * @param tableHashes  id → stored content_hash for rows already in the table
 * @param tableExists  whether the LanceDB table exists at all (drives 'missing')
 */
export function planReconcile(diskFiles, tableHashes, tableExists) {
    const toEmbedNew = [];
    const toEmbedChanged = [];
    const unchanged = [];
    const embedPaths = [];
    const diskIds = new Set();
    for (const f of diskFiles) {
        diskIds.add(f.id);
        const stored = tableHashes.get(f.id);
        if (stored === undefined) {
            toEmbedNew.push(f.id);
            embedPaths.push(f.absPath);
        }
        else if (isStale(stored, f.content)) {
            toEmbedChanged.push(f.id);
            embedPaths.push(f.absPath);
        }
        else {
            unchanged.push(f.id);
        }
    }
    // Orphans: rows whose file is gone from disk. Reported so the daemon can drop
    // them; never blocks the embed work.
    const toRemove = [...tableHashes.keys()].filter((id) => !diskIds.has(id));
    let state;
    if (diskFiles.length === 0)
        state = 'empty';
    else if (!tableExists)
        state = 'missing';
    else if (toEmbedNew.length || toEmbedChanged.length || toRemove.length)
        state = 'stale';
    else
        state = 'fresh';
    return { toEmbedNew, toEmbedChanged, toRemove, unchanged, embedPaths, state };
}
//# sourceMappingURL=reconcile.js.map