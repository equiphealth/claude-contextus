---
name: lancedb-api-surface
description: Real @lancedb/lancedb v0.30 API vs DESIGN.md's Chroma-shaped sketch; verified by Phase-0 round-trip
type: reference
category: implementation
tags: [lancedb, vector-db, api, phase-0]
---

# LanceDB API Surface (verified against v0.30.0)

**Status**: Confirmed by `scripts/verify-lance.ts` round-tripping against the installed
`@lancedb/lancedb@0.30.0` — not from docs. Re-run that script if the dependency bumps.

## The real API (what `lib/lance-client.ts` uses)

```
lancedb.connect(dir)              -> Connection         (file-based; dir is created if absent)
conn.tableNames()                 -> string[]
conn.createTable(name, rows)      -> Table              (infers schema from rows; needs ≥1 row)
conn.openTable(name)              -> Table
conn.dropTable(name)              -> void
table.add(rows)                   -> append
table.search(vector).limit(n).where(sql).toArray()  -> rows incl. `_distance`
table.mergeInsert('id').whenMatchedUpdateAll().whenNotMatchedInsertAll().execute(rows)  -> upsert-by-id
table.countRows()                 -> number
```

## DESIGN.md divergences (DESIGN.md was wrong; code is right)

1. **`new LanceDBClient({path})` / `getOrCreateCollection()` / `collection.metadata()`**
   (DESIGN.md §"Phase 1", ~line 1421) **do not exist.** That is the ChromaDB shape. Use
   `connect → createTable/openTable`.

2. **`.execute()` is `protected` on the query builder in v0.30.** The public terminal is
   **`.toArray()`**. `poc/ingest-test.ts` uses `.execute()` and would throw — it predates this version.

3. **LanceDB has no collection-level metadata** (Chroma did). Model/dimension provenance lives
   in a JSON sidecar (`contextus.meta.json`) next to the DB dir — see `readTableMeta`/`writeTableMeta`.
   The model/dimension _validation_ logic from DESIGN.md survives unchanged; it just reads the sidecar.

## Gotchas

- **`createTable` needs ≥1 row** to infer the schema. Empty-table creation requires an explicit
  Arrow schema (`createEmptyTable`) — avoided in v1.
- **`tags` is stored as a comma-joined string**, not a list column. LanceDB infers scalar columns
  from JS arrays awkwardly; an explicit Arrow schema is the v2 path once CAE consumes tags
  (tags are inert in v1 anyway).
- **`similarity = 1 - _distance`** assumes cosine space. Self-similarity verified ≈ 1.0000.
- Embedding model id is **config-driven** (`lib/config.ts`), locked to
  `nomic-ai/nomic-embed-text-v1.5` (768-dim). Never hardcode the model at call sites.
