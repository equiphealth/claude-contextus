---
name: hit-tracking
description: How retrieval hit counters work, when they increment, and what uses them
metadata:
  type: implementation
  tags: [hits, tracking, calibration, audit]
---

# Hit Tracking Implementation

**Hit tracking** counts how many times each pattern has been retrieved (injected above the floor). Powers `/introspect`, `/audit-stale`, and calibration quality signals.

## Data Storage

**Location:** LanceDB table, per-row columns:

```typescript
interface ContextRow {
  id: string;
  // ... other fields
  hit_count: number;      // Total times retrieved
  last_hit: string;       // ISO timestamp of last retrieval ('' if never)
  updated_at: string;     // When pattern was last embedded
}
```

**Persistent:** Survives daemon restarts (stored in LanceDB, not memory).

## When Hits Are Incremented

**After injection floor** — Only patterns that actually get injected are counted:

```typescript
// daemon/server.ts, after applyFloor()
if (kept.length > 0) {
  const injectedIds = kept.map(r => r.id);
  await incrementHits(injectedIds, project);
}
```

**NOT incremented:**
- Patterns below the floor (dropped)
- Patterns returned by search but not injected (e.g., deduped, topK-trimmed)
- No-inject queries (nothing cleared the floor)

**Why after floor?** Hit count measures "how often was this pattern actually useful" — not "how often did it score >0.0".

## Increment Logic

```typescript
export async function incrementHits(ids: string[], projectDir?: string): Promise<void> {
  const table = await getTable(projectDir);
  const now = new Date().toISOString();
  
  for (const id of ids) {
    await table
      .update()
      .where(`id = '${id}'`)
      .set({ 
        hit_count: table.column('hit_count').add(1),
        last_hit: now 
      });
  }
}
```

**Batch-safe:** Multiple IDs in one call (typically 3-5 per injection).

**Time:** ~5-10ms per batch (LanceDB update is fast).

## Reading Hit Data

**/introspect endpoint:**

```bash
curl -s "http://localhost:37800/introspect?project=/path" | jq .hitTracking
```

**Response:**
```json
{
  "hitTracking": {
    "topPatterns": [
      { "pattern": "dev/LOGGING.md", "hits": 15 },
      { "pattern": "calibration.md", "hits": 12 },
      { "pattern": "dev/DESIGN.md", "hits": 8 }
    ],
    "zeroHitPatterns": [
      "reference/unused-pattern.md",
      "gotchas/gotcha-old-quirk.md"
    ]
  }
}
```

**Query:**
```typescript
// Top 10 most-hit patterns
const top = await table
  .select(['id', 'filename', 'hit_count'])
  .where('hit_count > 0')
  .orderBy('hit_count DESC')
  .limit(10)
  .toArray();

// Zero-hit patterns (never retrieved)
const zero = await table
  .select(['id', 'filename'])
  .where('hit_count = 0')
  .toArray();
```

## Use Cases

### 1. Audit Stale Patterns

**/audit-stale skill:**

Finds patterns with `hit_count = 0` — never retrieved, might be:
- Too niche (valid but rarely relevant)
- Outdated (replaced by newer patterns)
- Poor description (not matching semantic queries)
- Orphaned (file exists but no one asks about it)

**Action:** Review, update, or remove.

---

### 2. Calibration Quality Signal

**Usage-to-injection ratio:**

```typescript
const usageRate = usedPatterns.length / injectedPatterns.length;
```

If `usageRate < 0.3` (only 30% of injections are used), the floor might be too low.

**Requires:** Post-prompt Stop hook evaluation (v2, not yet implemented).

---

### 3. Pattern Health Dashboard

**/context-status shows:**
- Most-hit patterns (what's working)
- Zero-hit patterns (what's not)
- Hit distribution (are 3 patterns getting all hits, or is it spread?)

---

### 4. Reranking Recency Boost

**Recent hits get small boost:**

```typescript
const daysSinceHit = (Date.now() - Date.parse(row.last_hit)) / (1000 * 60 * 60 * 24);
const recencyBoost = daysSinceHit < 7 ? 0.02 : 0;

finalScore = similarity + typeBoost + recencyBoost;
```

Patterns used in the last week rank slightly higher (assumes active topics stay relevant).

## Resetting Hits

**Manual reset (destructive):**

```typescript
await table.update().set({ hit_count: 0, last_hit: '' });
```

**When to reset:** After a major corpus refactor where old hit counts are misleading.

**Better approach:** Don't reset — hits are historical signal. If a pattern becomes stale, hits decay naturally (newer patterns start accumulating hits).

## Schema Fields

**hit_count:**
- Type: `number`
- Initial: `0` (when pattern is embedded)
- Increment: `+1` per injection

**last_hit:**
- Type: `string` (ISO 8601 timestamp)
- Initial: `''` (never hit)
- Update: Set to `now()` on each injection

**updated_at:**
- Type: `string` (ISO 8601 timestamp)
- Initial: When pattern is first embedded
- Update: When pattern is re-embedded (file changed)

## Observability

**Logged on increment:**

Not explicitly logged (would spam daemon.log). Hits are visible via:
- `/introspect` endpoint
- `/context-status` skill
- Direct LanceDB query

**Paranoid mode log** (if enabled) shows hits in retrieval event:

```json
{
  "event": "retrieval",
  "retrieved": ["dev/LOGGING.md"],
  "hits": [15]
}
```

## Tradeoffs

**Pros:**
- Persistent (survives daemon restarts)
- Per-row (fine-grained tracking)
- Informs calibration, audits, health dashboards

**Cons:**
- Adds ~5-10ms latency per injection (LanceDB update)
- No batch writes (updates are serial per ID)
- Doesn't track "below-floor but close" patterns (only injected ones)

## Code Location

- `lib/storage/lance-client.ts` — `incrementHits()` (lines 180-195)
- `daemon/server.ts` — Increment call after floor (around line 401)
- `lib/introspect.ts` — Read hit data for `/introspect`
- `skills/audit-context/` — Zero-hit detection

## Related

- **/introspect** — Exposes hit tracking data
- **/audit-stale** — Finds zero-hit patterns
- **Calibration** — Uses hit data for quality signals
- **Reranking** — Recency boost from `last_hit`
