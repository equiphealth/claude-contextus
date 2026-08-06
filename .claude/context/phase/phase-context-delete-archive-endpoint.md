---
name: context-delete-archive-endpoint
description: Design for /delete endpoint: move to .archive, remove from index/embeddings
metadata:
  type: phase
  tags: ["daemon", "api", "corpus-management"]
---

# Context Delete/Archive Endpoint

## Goal

Provide safe deletion of context files via daemon endpoint — archive instead of permanent delete, no restore complexity for v1.

## Design

### Endpoint: `/delete`

**Input:**
```json
{
  "relPath": "decisions/decision-foo.md",
  "cwd": "/path/to/project"
}
```

**Process:**
1. Resolve absolute path: `.claude/context/<relPath>`
2. Create archive directory if needed: `.claude/context/.archive/<category>/`
3. Move file to archive
4. Remove entry from CONTEXT.md index (text munging)
5. Delete embeddings from LanceDB by context id
6. Return success with archived path

**Output:**
```json
{
  "ok": true,
  "archived": ".claude/context/.archive/decisions/decision-foo.md",
  "removedFromIndex": true,
  "embeddingsDeleted": 3
}
```

### Archive Exclusion

Add to default exclude patterns in `lib/config.ts`:
```typescript
exclude: ["**/.archive/**", "**/CONTEXT.md", ...]
```

### Skill: `/context-delete` or `/ctx delete`

Wrapper that:
1. Prompts for confirmation if pattern matches multiple files
2. Shows what will be archived
3. Calls daemon `/delete`
4. Reports results

## Implementation Checklist

- [ ] Add `.archive/` to default source exclude patterns
- [ ] Implement `/delete` endpoint in daemon/server.ts
- [ ] Create `/context-delete` skill
- [ ] Add to `/ctx` dispatcher as `/ctx delete`
- [ ] Tests: delete file, verify not in queries, verify archive exists
- [ ] Update CLAUDE.md with delete workflow

## Manual Archive Cleanup

User can periodically purge:
```bash
rm -rf .claude/context/.archive
```

No automatic purge for v1.

## Future Enhancements

- `/restore` endpoint (move back, re-embed, update index)
- `/purge-archive` endpoint (permanent delete)
- Archive timestamp metadata (auto-purge after N days)
- Batch delete (multiple files)

## Related

- Bug lifecycle already uses move pattern (gotcha → implementation)
- Aligns with "safe by default" philosophy
