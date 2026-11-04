---
name: daemon-context-create-vs-update
description: How to create new vs update existing context files - /capture overwrites on duplicate slug
metadata:
  type: reference
  tags: ["daemon", "context-capture", "workflow", "api"]
---

# Daemon Context File Lifecycle: Create vs Update

## Single Endpoint for Both

**`POST /capture` handles both create AND update:**
- **First time with a slug:** Creates new file
- **Same slug again:** Overwrites existing file (this is how you update)

```bash
BASE_URL=$(bash ~/.contextus/scripts/daemon-url.sh)
curl -s -X POST "$BASE_URL/capture" \
  -H 'content-type: application/json' \
  -d '{"slug":"my-pattern","description":"...","category":"reference","body":"updated content","cwd":"$(pwd)"}'
```
Never hardcode the port — `~/.contextus/scripts/daemon-url.sh` resolves it with the same priority the hooks use (`scripts/lib/daemon-control.js` `getBaseURL()`).

## How It Works

1. **Creating new context:**
   ```bash
   # First call - creates reference/reference-logging-pattern.md
   /capture {slug: "logging-pattern", category: "reference", body: "..."}
   ```

2. **Updating that context:**
   ```bash
   # Second call with same slug - overwrites the file
   /capture {slug: "logging-pattern", category: "reference", body: "updated..."}
   ```

## Filename = Category + Slug

The filename is deterministic: `<category>/<type>-<slug>.md`

- Same slug + same category = same file path = overwrite (update)
- Different slug = different file path = new file (create)

## The /create-context Skill

The skill adds deduplication on top of `/capture`:

1. Runs semantic similarity search
2. If similar context found (>= 0.75):
   - Asks if you want to update existing or create new
   - If update: calls `/capture` with the EXISTING slug (overwrites)
   - If create new: calls `/capture` with a NEW slug
3. If no similar context (< 0.75):
   - Calls `/capture` with new slug

## Staging Mode Workflow

When staging mode says "call /capture":

**Good for:** Brand new patterns you know don't exist

**Risk:** Might create duplicates if similar context exists

**Better approach:** Invoke `/create-context` skill which:
- Checks for duplicates
- Routes to correct slug (existing or new)
- Ensures no duplicate context files

## Direct /capture Use Cases

**When to call /capture directly:**
1. You KNOW it's new (no similar context exists)
2. You're updating a specific known file (use its exact slug)
3. Performance matters (skip similarity check)

**When to use /create-context skill:**
1. Unsure if similar context exists
2. Want automatic deduplication
3. Interactive clarification is acceptable

## API Endpoints (Daemon)

```
POST /capture    → create new OR overwrite existing (deterministic by slug)
POST /query      → semantic search for retrieval
POST /notify     → file watcher notification
POST /reconcile  → sync filesystem ↔ vector DB
```

No separate `/update` endpoint needed - `/capture` handles both operations.
