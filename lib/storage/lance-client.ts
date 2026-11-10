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
import type { Connection, Table } from '@lancedb/lancedb';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveDBPath } from '../config.js';

export const TABLE_NAME = 'contextus';

/** Provenance persisted alongside the table (LanceDB has no collection metadata). */
export interface TableMeta {
  /** which provider built the corpus — must match at query time */
  provider: string;
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
}

export interface ProviderInfo {
  provider: string;
  model: string;
  ollamaModel?: string;
}

export function assertTableMetaCompatible(
  info: ProviderInfo,
  dimensions: number,
  projectName?: string,
  requireMeta = false
): void {
  const meta = readTableMeta(projectName);
  if (!meta) {
    if (requireMeta) throw new Error('Existing corpus has no readable embedding metadata; rebuild it before writing.');
    return;
  }
  const expectedModel = info.provider === 'ollama' ? info.ollamaModel ?? info.model : info.model;
  if (
    meta.provider !== info.provider ||
    meta.embeddingModel !== expectedModel ||
    meta.dimensions !== dimensions
  ) {
    throw new Error(
      `Embedding configuration conflicts with the existing corpus: ` +
        `existing ${meta.provider}/${meta.embeddingModel}/${meta.dimensions}, ` +
        `requested ${info.provider}/${expectedModel}/${dimensions}. Rebuild the corpus with one shared embedding configuration.`
    );
  }
}

/** A row stored in the contextus table. */
export interface ContextRow {
  /** stable id: '<projectHash>:<relative-path>:<chunk_index>' */
  id: string;
  /** project identifier: sha256(absolutePath).slice(0, 12) — opaque, stable */
  project: string;
  /** embedding vector */
  vector: number[];
  /** full markdown content (no frontmatter) */
  document: string;
  /** source-relative path of the FILE this chunk came from (shared across chunks) */
  filename: string;
  /** 0-based ordinal of this chunk within its file (0 for whole-file rows) */
  chunk_index: number;
  /** the nearest enclosing markdown heading for this chunk ('' if none) */
  heading: string;
  /** frontmatter type (decision|gotcha|reference|project|...) */
  type: string;
  /** source pack the row came from (re-ranker SOURCE_WEIGHTS key) */
  source: string;
  /** comma-joined tags (LanceDB infers scalar columns; arrays need explicit schema) */
  tags: string;
  /** retrieval hit counter (re-ranking + calibration) */
  hit_count: number;
  /** ISO timestamp of last retrieval, '' if never */
  last_hit: string;
  /** ISO timestamp written at ingest */
  updated_at: string;
  /** SHA-256 of the embedded body — lets incremental re-embed skip unchanged files */
  content_hash: string;
}

/** A search result: a row plus LanceDB's `_distance` and derived similarity. */
export interface SearchResult extends ContextRow {
  /** L2² distance from query (lower = closer). LanceDB default metric is L2. */
  distance: number;
  /** Cosine similarity derived from L2² on unit vectors: 1 - L2²/2 */
  similarity: number;
}

/** Single memoized connection — unified DB, all projects in one LanceDB. */
let _conn: Connection | null = null;

/** Open (memoized) the unified LanceDB connection. */
export async function getConnection(_projectName?: string): Promise<Connection> {
  if (_conn) return _conn;
  const dir = resolveDBPath();
  fs.mkdirSync(dir, { recursive: true });
  _conn = await lancedb.connect(dir);
  return _conn;
}

/** Sidecar path holding TableMeta for a given project DB dir. */
function metaPath(projectName?: string): string {
  return path.join(resolveDBPath(projectName), `${TABLE_NAME}.meta.json`);
}

/** Read persisted table provenance, or null if not yet written. */
export function readTableMeta(projectName?: string): TableMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(projectName), 'utf-8')) as TableMeta;
  } catch {
    return null;
  }
}

/** Write table provenance sidecar. */
export function writeTableMeta(meta: TableMeta, projectName?: string): void {
  fs.writeFileSync(metaPath(projectName), JSON.stringify(meta, null, 2));
}

/**
 * Create (or replace) the contextus table from an initial batch of rows and
 * stamp provenance. Throws if rows is empty (LanceDB needs data to infer schema).
 */
export async function createTable(
  rows: ContextRow[],
  opts: {
    projectName?: string;
    replace?: boolean;
    /** Embedding provider info for metadata (falls back to loadConfig() if omitted) */
    providerInfo?: ProviderInfo;
  } = {}
): Promise<Table> {
  if (rows.length === 0) {
    throw new Error('createTable needs at least one row to infer schema');
  }
  const conn = await getConnection(opts.projectName);
  const names = await conn.tableNames();
  if (names.includes(TABLE_NAME)) {
    if (opts.replace) {
      await conn.dropTable(TABLE_NAME);
    } else {
      // Same cold-start race as upsertRows/getContentHashes, one layer
      // deeper: tableNames() can report the table before conn.openTable()
      // can actually see a committed version for it yet (observed directly
      // — see getContentHashes's comment for the full repro). Treat a throw
      // here as "it doesn't really exist yet" and fall through to create it
      // for real, rather than propagating a transient error for a table
      // that functionally never existed from the caller's point of view.
      assertTableMetaCompatible(opts.providerInfo || loadConfig().embedding, rows[0].vector.length, opts.projectName, true);
      try {
        return await conn.openTable(TABLE_NAME);
      } catch {
        // fall through to createTable below
      }
    }
  }
  const providerInfo = opts.providerInfo || loadConfig().embedding;
  if (!opts.replace) {
    assertTableMetaCompatible(providerInfo, rows[0].vector.length, opts.projectName);
  }
  const table = await conn.createTable(TABLE_NAME, rows as unknown as Record<string, unknown>[]);

  // Use provided providerInfo (from caller's 3-tier config) or fall back to loadConfig()
  const { provider, model, ollamaModel } = providerInfo;
  writeTableMeta(
    {
      provider,
      embeddingModel: provider === 'ollama' ? (ollamaModel ?? model) : model,
      dimensions: rows[0].vector.length,
      createdAt: new Date().toISOString()
    },
    opts.projectName
  );
  return table;
}

/** Open the existing contextus table (throws if it doesn't exist). */
export async function openTable(projectName?: string): Promise<Table> {
  const conn = await getConnection(projectName);
  return conn.openTable(TABLE_NAME);
}

/** Whether the contextus table exists. */
export async function tableExists(projectName?: string): Promise<boolean> {
  const conn = await getConnection(projectName);
  return (await conn.tableNames()).includes(TABLE_NAME);
}

/**
 * Upsert rows by `id` (insert new, overwrite existing). Uses mergeInsert so an
 * incremental re-embed of one file doesn't rebuild the table.
 *
 * Self-heals a cold start: `openTable` throws if the table has never been
 * created for this project's DB — which used to make this the single point
 * where a project's FIRST-EVER incremental embed via /notify (before any
 * reconcile has run to bootstrap the table) crashed uncaught, degrading the
 * whole request to `{continue: true}` with no indication anything went wrong
 * (GH issue #22 — found via a projectDocs /notify integration test that
 * hits exactly this on a brand-new project). Bootstrapping here, not just in
 * runReconcile, means /notify works correctly the very first time it's ever
 * called for a project, not only after reconcile has already run once.
 */
/** True for the specific "dataset/table not found" error class this whole
 * file self-heals around — a transient LanceDB consistency gap on a cold
 * start, not a real failure. Narrow on purpose: only retry THIS, never mask
 * an unrelated error. */
function isColdStartNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /was not found|not found:/i.test(msg);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

let writeQueue: Promise<void> = Promise.resolve();

export function upsertRows(rows: ContextRow[], projectName?: string, providerInfo?: ProviderInfo): Promise<void> {
  const operation = writeQueue.then(() => upsertRowsUnlocked(rows, projectName, providerInfo));
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function upsertRowsUnlocked(rows: ContextRow[], projectName?: string, providerInfo?: ProviderInfo): Promise<void> {
  if (rows.length === 0) return;
  // Reuse the Table handle createTable() already returns when it just
  // created the table — do NOT discard it and immediately re-open via a
  // separate openTable() call. That re-open raced against the table it had
  // just created becoming visible (observed directly: tableExists() true,
  // openTable() still throwing "Table ... was not found" moments later) —
  // on a cold start, createTable's own handle is always valid immediately,
  // openTable() right after is not guaranteed to be. If another caller
  // raced us and created it first, createTable() just opens it without
  // inserting (see its `replace` contract) — its returned handle is still
  // correct either way.
  //
  // Even with that fix, a brand-new table's FIRST mergeInsert().execute()
  // can still throw the identical "not found" error — observed directly,
  // ~20% of first-ever /notify calls against a truly fresh DB. This is a
  // deeper async-consistency gap inside @lancedb/lancedb itself: the
  // just-created table's committed version isn't always durable/visible by
  // the time a dataset-level operation like mergeInsert needs to see it,
  // even using the exact Table handle createTable() just returned. It's
  // provably transient (the identical operation succeeds moments later,
  // every time) — a short retry-with-backoff is the correct fix for this
  // class of gap, not another single-shot catch.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const exists = await tableExists(projectName);
      if (exists) assertTableMetaCompatible(providerInfo || loadConfig().embedding, rows[0].vector.length, projectName, true);
      const table = exists
        ? await openTable(projectName)
        : await createTable(rows, { projectName, providerInfo });
      await table
        .mergeInsert('id')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows as unknown as Record<string, unknown>[]);
      return;
    } catch (err) {
      if (!isColdStartNotFoundError(err)) throw err;
      lastErr = err;
      // 150, 300, 600, 1200, 2400ms — cheap for a background embed; the gap
      // this retries is transient but under real system load (contending
      // disk/CPU) can outlast a tighter budget than this.
      await sleep(150 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/**
 * Vector search. Returns topK rows with distance + similarity, scoped to
 * projects in `projectScope` (unified DB: WHERE project IN (...)).
 * Falls back to unscoped if no projectScope given (all rows).
 */
export async function search(
  vector: number[],
  topK: number,
  where?: string,
  projectName?: string,
  projectScope?: string[]
): Promise<SearchResult[]> {
  const table = await openTable(projectName);
  let q = table.search(vector).limit(topK);
  // Build the project scope filter
  const filters: string[] = [];
  if (projectScope && projectScope.length > 0) {
    const inList = projectScope.map((p) => `'${p.replace(/'/g, "''")}'`).join(', ');
    filters.push(`project IN (${inList})`);
  }
  if (where) filters.push(where);
  if (filters.length > 0) q = q.where(filters.join(' AND '));
  // .toArray() is the public terminal in v0.30 — .execute() is protected.
  const rows = (await q.toArray()) as Array<ContextRow & { _distance: number }>;
  return rows.map((r) => ({
    ...r,
    distance: r._distance,
    similarity: 1 - r._distance / 2
  }));
}

/** Total row count. */
export async function countRows(projectName?: string): Promise<number> {
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
export async function incrementHits(ids: string[], projectName?: string): Promise<void> {
  if (ids.length === 0) return;
  const table = await openTable(projectName);
  const inList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  const nowIso = new Date().toISOString();
  await table.update({
    where: `id IN (${inList})`,
    valuesSql: { hit_count: 'hit_count + 1', last_hit: `'${nowIso}'` }
  });
}

/**
 * Delete rows by id (orphan cleanup during reconcile). No-op on empty input.
 * Best-effort, single SQL delete with an `id IN (...)` predicate.
 */
export async function deleteRows(ids: string[], projectName?: string): Promise<void> {
  if (ids.length === 0) return;
  if (!(await tableExists(projectName))) return;
  const table = await openTable(projectName);
  const inList = ids.map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
  await table.delete(`id IN (${inList})`);
}

/**
 * Delete every chunk row of a file by its `filename`, scoped to a project hash.
 * Used when a file is re-embedded into a DIFFERENT chunk count — stale high-index
 * rows must go before the new chunks are upserted, or orphan chunks linger.
 * No-op if no table.
 */
export async function deleteByFilename(
  filename: string,
  projectName?: string,
  projectFilter?: string
): Promise<void> {
  if (!(await tableExists(projectName))) return;
  const table = await openTable(projectName);
  const escaped = filename.replace(/'/g, "''");
  const pred = projectFilter
    ? `filename = '${escaped}' AND project = '${projectFilter.replace(/'/g, "''")}'`
    : `filename = '${escaped}'`;
  await table.delete(pred);
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
 *
 * `projectFilter` scopes to a single project hash (unified DB: each project manages
 * only its own rows).
 */
export async function getContentHashes(
  projectName?: string,
  sourceFilter?: string,
  projectFilter?: string
): Promise<Map<string, string>> {
  if (!(await tableExists(projectName))) return new Map();
  // Same cold-start race upsertRows retries around (GH issue #22 and its
  // sibling gaps — see that function's comment), one call earlier in the
  // chain: tableExists() can say true (e.g. the directory exists) a moment
  // before openTable() can actually see a committed version yet.
  //
  // Deliberately a RETRY here, not a catch-and-return-empty-Map: an earlier
  // version of this fix did exactly that, and it was WORSE than the bug it
  // fixed — on a table that already has real data (not just a brand-new
  // one), hitting this same race made the staleness check think a known
  // file had NEVER been seen before, triggering a genuine duplicate
  // re-embed instead of correctly detecting "unchanged" (observed directly:
  // a second /notify for identical content wrote a SECOND captures.log
  // line instead of none). Silently returning empty data to paper over a
  // transient error changes real behavior, not just error-handling — only
  // acceptable here because retrying resolves the race in practice.
  let table: Table | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      table = await openTable(projectName);
      break;
    } catch (err) {
      if (!isColdStartNotFoundError(err) || attempt === 5) return new Map();
      await sleep(150 * 2 ** attempt);
    }
  }
  if (!table) return new Map();
  let query = table.query().select(['filename', 'content_hash', 'source', 'project']);
  if (projectFilter) {
    query = query.where(`project = '${projectFilter.replace(/'/g, "''")}'`);
  }
  const rows = (await query.toArray()) as Array<{
    filename: string;
    content_hash?: string;
    source?: string;
    project?: string;
  }>;
  const map = new Map<string, string>();
  for (const r of rows) {
    if (sourceFilter && (r.source ?? 'projectContext') !== sourceFilter) continue;
    if (!map.has(r.filename)) map.set(r.filename, r.content_hash ?? '');
  }
  return map;
}

/**
 * Delete all rows for a given project hash (workspace cleanup / project removal).
 * Uses a WHERE predicate pushed to LanceDB — O(matching rows), not O(total).
 */
export async function deleteByProject(projectHash: string): Promise<number> {
  if (!(await tableExists())) return 0;
  const table = await openTable();
  const escaped = projectHash.replace(/'/g, "''");
  // Count first so we can report how many were deleted.
  const rows = (await table
    .query()
    .select(['id'])
    .where(`project = '${escaped}'`)
    .toArray()) as Array<{ id: string }>;
  if (rows.length === 0) return 0;
  await table.delete(`project = '${escaped}'`);
  return rows.length;
}

/** Reset memoized connection (tests / daemon restart). */
export function resetConnection(): void {
  _conn = null;
}
