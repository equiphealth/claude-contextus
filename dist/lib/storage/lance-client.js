/**
 * LanceDB client — file-based vector store for contextus.
 *
 * Uses @lancedb/lancedb v0.30. The real API differs from DESIGN.md's original
 * sketch (which used a Chroma-shaped surface). Verified divergences are
 * documented in DESIGN_DIVERGENCE below and confirmed by the Phase-0 round-trip
 * (scripts/verify-lance.ts).
 *
 * Real surface used here:
 *   lancedb.connect(dir)        -> Connection
 *   conn.tableNames()           -> string[]
 *   conn.createTable(name,rows) -> Table
 *   conn.openTable(name)        -> Table
 *   table.add(rows)             -> append
 *   table.search(vector)        -> VectorQuery
 *     .limit(n).toArray()       -> rows incl. `_distance`  (NOTE: .execute() is protected)
 *   table.mergeInsert('id')...  -> upsert-by-id
 *   table.countRows()           -> number
 *
 * LanceDB has NO collection-level metadata store (Chroma did). Model/dimension
 * provenance is persisted in a JSON sidecar next to the table dir instead.
 */
import * as lancedb from '@lancedb/lancedb';
import fs from 'fs';
import path from 'path';
import { loadConfig, resolveDBPath } from '../config.js';
export const TABLE_NAME = 'contextus';
/**
 * Connections are memoized per resolved DB dir, not globally: the daemon is a
 * single shared process serving many projects (DESIGN.md §"Daemon Lifecycle"),
 * so one cached connection would pin every query to the first project seen.
 */
const _conns = new Map();
/** Open (memoized per-project) the file-based LanceDB connection for a project. */
export async function getConnection(projectName) {
    const dir = resolveDBPath(projectName);
    const cached = _conns.get(dir);
    if (cached)
        return cached;
    fs.mkdirSync(dir, { recursive: true });
    const conn = await lancedb.connect(dir);
    _conns.set(dir, conn);
    return conn;
}
/** Sidecar path holding TableMeta for a given project DB dir. */
function metaPath(projectName) {
    return path.join(resolveDBPath(projectName), `${TABLE_NAME}.meta.json`);
}
/** Read persisted table provenance, or null if not yet written. */
export function readTableMeta(projectName) {
    try {
        return JSON.parse(fs.readFileSync(metaPath(projectName), 'utf-8'));
    }
    catch {
        return null;
    }
}
/** Write table provenance sidecar. */
export function writeTableMeta(meta, projectName) {
    fs.writeFileSync(metaPath(projectName), JSON.stringify(meta, null, 2));
}
/**
 * Create (or replace) the contextus table from an initial batch of rows and
 * stamp provenance. Throws if rows is empty (LanceDB needs data to infer schema).
 */
export async function createTable(rows, opts = {}) {
    if (rows.length === 0) {
        throw new Error('createTable needs at least one row to infer schema');
    }
    const conn = await getConnection(opts.projectName);
    const names = await conn.tableNames();
    if (names.includes(TABLE_NAME)) {
        if (!opts.replace)
            return conn.openTable(TABLE_NAME);
        await conn.dropTable(TABLE_NAME);
    }
    const table = await conn.createTable(TABLE_NAME, rows);
    const cfg = loadConfig();
    const { provider, model, ollamaModel } = cfg.embedding;
    writeTableMeta({
        provider,
        embeddingModel: provider === 'ollama' ? ollamaModel : model,
        dimensions: rows[0].vector.length,
        createdAt: new Date().toISOString(),
    }, opts.projectName);
    return table;
}
/** Open the existing contextus table (throws if it doesn't exist). */
export async function openTable(projectName) {
    const conn = await getConnection(projectName);
    return conn.openTable(TABLE_NAME);
}
/** Whether the contextus table exists. */
export async function tableExists(projectName) {
    const conn = await getConnection(projectName);
    return (await conn.tableNames()).includes(TABLE_NAME);
}
/**
 * Upsert rows by `id` (insert new, overwrite existing). Uses mergeInsert so an
 * incremental re-embed of one file doesn't rebuild the table.
 */
export async function upsertRows(rows, projectName) {
    if (rows.length === 0)
        return;
    const table = await openTable(projectName);
    await table
        .mergeInsert('id')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows);
}
/**
 * Vector search. Returns topK rows with distance + similarity, optionally
 * filtered by a SQL predicate (e.g. `type = 'decision'`).
 */
export async function search(vector, topK, where, projectName) {
    const table = await openTable(projectName);
    let q = table.search(vector).limit(topK);
    if (where)
        q = q.where(where);
    // .toArray() is the public terminal in v0.30 — .execute() is protected.
    const rows = (await q.toArray());
    return rows.map((r) => ({
        ...r,
        distance: r._distance,
        similarity: 1 - r._distance,
    }));
}
/** Total row count. */
export async function countRows(projectName) {
    const table = await openTable(projectName);
    return table.countRows();
}
/**
 * Increment the hit counter for a set of retrieved rows and stamp last_hit.
 * Called after a successful injection so the re-ranker's hitCountBoost learns
 * which patterns actually get retrieved (DESIGN.md §"Re-ranking"). Best-effort:
 * a failed update must never break the query response, so the caller swallows.
 *
 * Uses a single SQL `update` with an `id IN (...)` predicate and `valuesSql` so
 * `hit_count = hit_count + 1` happens server-side in one pass (the doc's
 * recommended path over per-row updates).
 */
export async function incrementHits(ids, projectName) {
    if (ids.length === 0)
        return;
    const table = await openTable(projectName);
    const inList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    const nowIso = new Date().toISOString();
    await table.update({
        where: `id IN (${inList})`,
        valuesSql: { hit_count: 'hit_count + 1', last_hit: `'${nowIso}'` },
    });
}
/**
 * Delete rows by id (orphan cleanup during reconcile). No-op on empty input.
 * Best-effort, single SQL delete with an `id IN (...)` predicate.
 */
export async function deleteRows(ids, projectName) {
    if (ids.length === 0)
        return;
    if (!(await tableExists(projectName)))
        return;
    const table = await openTable(projectName);
    const inList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
    await table.delete(`id IN (${inList})`);
}
/**
 * Delete every chunk row of a file by its `filename` (used when a file is
 * re-embedded into a DIFFERENT chunk count — stale high-index rows must go before
 * the new chunks are upserted, or orphan chunks linger). No-op if no table.
 */
export async function deleteByFilename(filename, projectName) {
    if (!(await tableExists(projectName)))
        return;
    const table = await openTable(projectName);
    await table.delete(`filename = '${filename.replace(/'/g, "''")}'`);
}
/**
 * Map of FILENAME → stored content_hash for staleness checks (empty if no table).
 * Keyed by filename, not row id: a file is now many chunk rows that share one
 * (file-level) content_hash, so we collapse them to one entry per file — which is
 * exactly the unit the staleness gate and reconcile planner reason about.
 *
 * `sourceFilter` scopes the map to one source pack — the reconcile path uses it so
 * it only manages `projectContext` rows and never treats doc-source rows (which
 * refresh on a full embed, not incrementally) as orphans to delete.
 */
export async function getContentHashes(projectName, sourceFilter) {
    if (!(await tableExists(projectName)))
        return new Map();
    const table = await openTable(projectName);
    const rows = (await table
        .query()
        .select(['filename', 'content_hash', 'source'])
        .toArray());
    const map = new Map();
    for (const r of rows) {
        if (sourceFilter && (r.source ?? 'projectContext') !== sourceFilter)
            continue;
        if (!map.has(r.filename))
            map.set(r.filename, r.content_hash ?? '');
    }
    return map;
}
/** Reset memoized connections (tests / daemon restart). */
export function resetConnection() {
    _conns.clear();
}
//# sourceMappingURL=lance-client.js.map