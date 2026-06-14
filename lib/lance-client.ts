/**
 * LanceDB client — file-based vector store for contextus.
 *
 * Replaces the old ChromaDB client. The real @lancedb/lancedb API (v0.30)
 * differs substantially from DESIGN.md's sketch (which used Chroma-shaped
 * `new LanceDBClient()` / `getOrCreateCollection()` / `collection.metadata()`
 * — none of which exist). Verified divergences are documented in DESIGN_DIVERGENCE
 * below and confirmed by the Phase-0 round-trip (scripts/verify-lance.ts).
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
import fs from 'fs';
import path from 'path';
import { loadConfig, resolveDBPath } from './config.js';

export const TABLE_NAME = 'contextus';

/** Provenance persisted alongside the table (LanceDB has no collection metadata). */
export interface TableMeta {
  /** which provider built the corpus — must match at query time */
  provider: string;
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
}

/** A row stored in the contextus table. */
export interface ContextRow {
  /** stable id, usually source-relative path */
  id: string;
  /** embedding vector */
  vector: number[];
  /** full markdown content (no frontmatter) */
  document: string;
  /** source-relative path */
  filename: string;
  /** frontmatter type (feedback|reference|decision|project|...) */
  type: string;
  /** comma-joined tags (LanceDB infers scalar columns; arrays need explicit schema) */
  tags: string;
  /** retrieval hit counter (re-ranking + calibration) */
  hit_count: number;
  /** ISO timestamp of last retrieval, '' if never */
  last_hit: string;
  /** ISO timestamp written at ingest */
  updated_at: string;
}

/** A search result: a row plus LanceDB's `_distance` and derived similarity. */
export interface SearchResult extends ContextRow {
  /** L2/cosine distance from query (lower = closer) */
  distance: number;
  /** 1 - distance (cosine space); higher = more similar */
  similarity: number;
}

/**
 * Connections are memoized per resolved DB dir, not globally: the daemon is a
 * single shared process serving many projects (DESIGN.md §"Daemon Lifecycle"),
 * so one cached connection would pin every query to the first project seen.
 */
const _conns = new Map<string, Connection>();

/** Open (memoized per-project) the file-based LanceDB connection for a project. */
export async function getConnection(projectName?: string): Promise<Connection> {
  const dir = resolveDBPath(projectName);
  const cached = _conns.get(dir);
  if (cached) return cached;
  fs.mkdirSync(dir, { recursive: true });
  const conn = await lancedb.connect(dir);
  _conns.set(dir, conn);
  return conn;
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
  opts: { projectName?: string; replace?: boolean } = {}
): Promise<Table> {
  if (rows.length === 0) {
    throw new Error('createTable needs at least one row to infer schema');
  }
  const conn = await getConnection(opts.projectName);
  const names = await conn.tableNames();
  if (names.includes(TABLE_NAME)) {
    if (!opts.replace) return conn.openTable(TABLE_NAME);
    await conn.dropTable(TABLE_NAME);
  }
  const table = await conn.createTable(TABLE_NAME, rows as unknown as Record<string, unknown>[]);

  const cfg = loadConfig();
  const { provider, model, ollamaModel } = cfg.embedding;
  writeTableMeta(
    {
      provider,
      embeddingModel: provider === 'ollama' ? ollamaModel : model,
      dimensions: rows[0].vector.length,
      createdAt: new Date().toISOString(),
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
 */
export async function upsertRows(rows: ContextRow[], projectName?: string): Promise<void> {
  if (rows.length === 0) return;
  const table = await openTable(projectName);
  await table
    .mergeInsert('id')
    .whenMatchedUpdateAll()
    .whenNotMatchedInsertAll()
    .execute(rows as unknown as Record<string, unknown>[]);
}

/**
 * Vector search. Returns topK rows with distance + similarity, optionally
 * filtered by a SQL predicate (e.g. `type = 'decision'`).
 */
export async function search(
  vector: number[],
  topK: number,
  where?: string,
  projectName?: string
): Promise<SearchResult[]> {
  const table = await openTable(projectName);
  let q = table.search(vector).limit(topK);
  if (where) q = q.where(where);
  // .toArray() is the public terminal in v0.30 — .execute() is protected.
  const rows = (await q.toArray()) as Array<ContextRow & { _distance: number }>;
  return rows.map((r) => ({
    ...r,
    distance: r._distance,
    similarity: 1 - r._distance,
  }));
}

/** Total row count. */
export async function countRows(projectName?: string): Promise<number> {
  const table = await openTable(projectName);
  return table.countRows();
}

/** Reset memoized connections (tests / daemon restart). */
export function resetConnection(): void {
  _conns.clear();
}
