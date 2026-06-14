---
name: lancedb-connect-parent-dir
description: LanceDB connect() takes the DB parent dir, not the .lance table dir — pointing at the table dir shows zero tables
metadata:
  type: reference
  tags: [lancedb, vector-inspector, gotcha]
---

**Gotcha**: `lancedb.connect(uri)` expects the **database directory**; tables are subdirectories inside it (e.g. `contextus.lance/`). Point a client (vector-inspector, our `lib/lance-client.ts`, the python lib) at the `.lance` table dir itself and it connects fine but lists **zero tables** — looks like an empty/missing DB.

**Concrete (this project)**:
- ✅ correct URI: `~/.contextus/data/claude-contextus` → table `contextus` appears (3 rows)
- ❌ wrong URI: `~/.contextus/data/claude-contextus/contextus.lance` → `list_tables()` returns `[]`

**Symptom**: "no data in the DB" in vector-inspector when the data is actually present on disk. Confirmed 2026-06-14 — VI was pointed at the table dir; repointing at the parent showed all rows.

**Diagnostic**: `list_tables()` returning empty while `find <dir> -name '*.lance'` shows a table dir = wrong connect level. Verified lancedb python 0.30.2 and `@lancedb/lancedb` 0.30 behave identically.

**Related**: [[lancedb-api-surface]] (in .claude/context/implementation/)
