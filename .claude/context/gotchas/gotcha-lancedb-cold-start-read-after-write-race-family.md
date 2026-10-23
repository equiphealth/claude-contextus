---
name: lancedb-cold-start-read-after-write-race-family
description: >-
  A family of LanceDB consistency gaps where tableNames()/tableExists() reports
  a table as present before openTable() or a dataset-level read can actually see
  a committed version yet - affects table creation, re-opening, and content-hash
  staleness checks differently and needs different fixes for each
metadata:
  type: gotcha
  tags:
    - lancedb
    - race-condition
    - cold-start
    - storage
---

## Symptom

`lib/storage/lance-client.ts` throws `Table 'contextus' was not found ... Dataset at path .../contextus.lance was not found: Not found: .../_versions` from several different call sites, intermittently (not consistently reproducible from a single run - needed dozens of iterations to characterize). GH issue #22 already fixed one instance of this (in `upsertRows`), but it turned out to be one of at least four distinct manifestations of the same underlying gap, each needing a different fix:

1. **`upsertRows` discarding `createTable()`'s own valid handle.** It called `createTable(rows)` (which internally creates AND returns a usable `Table`), then threw that handle away and called a SEPARATE `openTable()` right after - racing against the just-created table becoming visible via a fresh open, even though a perfectly good handle was already in hand. Fix: reuse the handle `createTable()` returns; only call `openTable()` in the already-exists branch.

2. **`createTable()`'s own "already exists, just open it" branch** had the identical unguarded re-open with no fallback. Fix: wrap in try/catch, fall through to actually creating the table if the race fires (treat "reported present but not openable" as "doesn't really exist yet").

3. **`getContentHashes`'s read path** hit the same race on `openTable()`. The FIRST fix attempt (catch the error, return an empty `Map`) was WORSE than the bug: on a table that already has real data (not a brand-new one), the same race made the staleness check think a known file had NEVER been seen before, triggering a genuine duplicate re-embed instead of correctly detecting "unchanged" - silently returning empty data to paper over a transient error changes real application behavior, not just error-handling. Fix: retry with backoff instead of masking.

4. **A distinct, DEEPER variant**: even with handles reused and opens retried, calling `mergeInsert().execute()` on a table immediately after writing to it moments earlier (two /notify calls back-to-back for the same file, machine-speed) can still see a stale/incomplete read - this is read-after-write consistency, not a thrown exception at all, so no retry-on-catch helps. Not fixed in production code - this specific pattern (re-querying milliseconds after writing the exact same data) isn't realistic for a real user anyway (nobody re-saves identical file content within milliseconds of themselves). Fixed at the TEST level with a short, realistic delay between the two calls instead of forcing a zero-latency consistency guarantee the library doesn't provide.

## How to apply

- Any new code path that calls `tableExists()`/`conn.tableNames()` and then separately calls `openTable()` (or relies on a dataset being immediately queryable right after a write) is a candidate for this exact race. Prefer reusing a Table handle you already have over re-opening by name.
- If a defensive catch is the only option, THINK about what the fallback value actually DOES downstream - returning "empty"/"not found" to recover from a transient read error can be fine (if it just means "redo some work") or actively wrong (if it means "this is new" when it's actually "this already exists, I just can't see it yet"). Prefer retry-with-backoff over catch-and-substitute-a-default when the default has real behavioral consequences.
- When writing an integration test against a LanceDB-backed table: use a FRESH project/table per test (never share one project dir across multiple tests in a file) - reusing one table across successive tests dramatically increases how often this race surfaces, since it compounds multiple create/open/write cycles against the same table in quick succession. And don't test back-to-back machine-speed re-identical-writes without an explicit, small, realistic delay - that specific timing pattern doesn't represent anything a real user does.

## Related

Found while adding logCapture() to the daemon's /notify handler (so a context file edited via Write/Edit, not /capture, also gets recorded in captures.log) - the new integration test for that fix is what surfaced all four of these, none of which were about captures.log itself.
