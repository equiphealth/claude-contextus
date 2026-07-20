---
name: ctx
description: Quick dispatcher — /ctx status|stats|create|calibrate|doctor|watch|daemon|setup|link|search|review|rebuild
---

# ctx — Context Skill Shortcuts

Quick shortcuts for contextus commands. Think `npm run` but for contextus.

## Usage

**Core Operations:**
```
/ctx status      → /context-status      (daemon health + activity)
/ctx stats       → /context-stats       (usage analytics)
/ctx create      → /create-context      (capture new pattern)
/ctx search      → /context-search      (find patterns)
```

**Tuning & Maintenance:**
```
/ctx calibrate   → /context-calibrate   (tune injection floor)
/ctx doctor      → /context-doctor      (troubleshoot issues)
/ctx review      → /context-review      (curate corpus)
/ctx tag         → /context-tag         (manage tags)
/ctx rebuild     → /rebuild-embeddings  (rebuild corpus)
```

**Setup & Control:**
```
/ctx setup       → /contextus-setup     (initial setup wizard)
/ctx daemon      → /manage-daemon       (start/stop/restart daemon)
/ctx configure   → /configure           (edit config)
/ctx upgrade     → /contextus-upgrade   (upgrade migration)
/ctx link        → /link-project        (share context with another project)
```

**Advanced:**
```
/ctx watch       → /contextus-watch     (live activity stream)
/ctx migrate     → /migrate-memory      (convert legacy memory)
/ctx audit       → /context-audit       (find corpus issues)
/ctx archive     → /context-archive     (archive stale patterns)
/ctx merge       → /context-merge       (merge duplicates)
```

## Instructions

When the user invokes `/ctx <subcommand>`:

1. **Parse subcommand** from the user's message (the word immediately after `/ctx`)
2. **Map to canonical skill** using the table above:
   - status → /context-status
   - stats → /context-stats
   - create → /create-context
   - search → /context-search
   - calibrate → /context-calibrate
   - doctor → /context-doctor
   - review → /context-review
   - tag → /context-tag
   - rebuild → /rebuild-embeddings
   - setup → /contextus-setup
   - daemon → /manage-daemon
   - configure → /configure
   - upgrade → /contextus-upgrade
   - link → /link-project
   - watch → /contextus-watch
   - migrate → /migrate-memory
   - audit → /context-audit
   - archive → /context-archive
   - merge → /context-merge
3. **Silently execute the canonical skill** with any remaining arguments/flags passed through (no "Executing..." message)

**Examples:**
- `/ctx status` → silently invoke `/context-status`
- `/ctx stats --window 7` → silently invoke `/context-stats --window 7`
- `/ctx daemon restart` → silently invoke `/manage-daemon restart`

**If no subcommand or unrecognized:**
Show the usage table above (grouped by category).

**Important:** Route without narration — the dispatcher is infrastructure, not a conversational skill.
