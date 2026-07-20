---
name: claude-code-skill-system-feature-requests
description: Feature requests for Claude Code skill system discovered while building contextus — native aliasing and argument autocomplete
metadata:
  type: reference
  tags: ["claude-code", "skills", "upstream-feedback", "product-requests"]
---

# Claude Code Skill System Feature Requests

**Context:** Limitations discovered while building contextus plugin (2026-07).

## 1. Native Alias Support

### Problem
Each skill alias requires its own `SKILL.md` file, even if it's just a pointer to the canonical skill. This consumes context budget unnecessarily.

**Current workaround:** Ultra-slim alias files (5-6 lines)
```markdown
---
name: ctx-status
description: Alias for /context-status
---

See [/context-status](../context-status/SKILL.md).
```

**Cost:** ~40-50 tokens per alias

### Feature Request

**Native aliasing in skill frontmatter:**
```yaml
# skills/context-status/SKILL.md
---
name: context-status
aliases: [ctx-status, status]
description: Health dashboard for contextus daemon
---
```

The runtime would register all three invocation names but only load one SKILL.md. Zero context overhead for aliases.

### Impact
- Eliminates duplicate skill files
- Reduces context consumption
- Cleaner skill directory structure
- Easier maintenance

---

## 2. Argument-Level Autocomplete

### Problem
Claude Code autocomplete works at the **skill name** level (`/con<tab>` → `/context-status`) but not at the **argument** level. Users of subcommand-style skills (like our `/ctx` dispatcher) can't tab-complete arguments.

**What users want:**
```bash
$ /ctx <tab>
status      daemon health + activity
stats       usage analytics  
create      capture new pattern
calibrate   tune injection floor
...
```

Like `git <tab>`, `npm run <tab>`, or shell completion.

### Feature Request

**Autocomplete API for skill arguments:**
```typescript
// Hypothetical API in skills/<name>/autocomplete.ts
export function autocomplete(
  partialArgs: string[],
  cursorPosition: number
): CompletionItem[] {
  if (partialArgs.length === 1) {
    return [
      { value: 'status', description: 'daemon health + activity' },
      { value: 'stats', description: 'usage analytics' },
      // ...
    ];
  }
  return [];
}
```

Or declarative in frontmatter:
```yaml
---
name: ctx
subcommands:
  status:
    description: daemon health + activity
    skill: /context-status
  stats:
    description: usage analytics
    skill: /context-stats
---
```

Claude Code would show these options when user types `/ctx <tab>`.

### Impact
- Better UX for dispatcher-style skills
- Familiar pattern (matches shell completion, npm, git)
- Encourages subcommand architecture (cleaner namespace)
- Self-documenting (autocomplete shows what's available)

---

## 3. Skill Metadata Queries (Lower Priority)

### Problem
Skills can't easily query their own metadata or other skills' metadata at runtime. Useful for dynamic help text, cross-skill coordination, or building meta-skills that operate on the skill registry.

### Feature Request

**Runtime API for skill metadata:**
```typescript
import { getSkillMetadata, listSkills } from '@claude/skills';

const myMetadata = getSkillMetadata('ctx');
// { name: 'ctx', description: '...', aliases: [...] }

const allSkills = listSkills({ namespace: 'contextus' });
// [ { name: 'context-status', ... }, ... ]
```

Useful for building help commands, skill discovery UIs, or validation.

---

## Where to Submit

1. **Claude Code Discord** — Developer channels (most direct)
2. **Anthropic feedback channels** — Official product feedback
3. **GitHub discussions** — If Claude Code has a public repo
4. **Direct contact** — If you have Anthropic connections

## Related Context

- `tradeoff-skill-alias-context-cost-tradeoff.md` — Why aliases matter and current workarounds
- `arch-skill-token-optimization-strategy.md` — How we minimized skill context overhead
- `skills/ctx/SKILL.md` — Our dispatcher implementation (works around autocomplete limitation)

## Status

**Partially actioned** (as of 2026-07-10):
- [ ] Compile these into a single feature request document
- [ ] Share in Claude Code Discord
- [ ] Reference in Anthropic feedback channels
- [ ] Track response/adoption

**Bug report filed:** https://github.com/anthropics/claude-code/issues/76471
- Related issue: local-command-caveat wraps skill invocations, creating contradictory instructions
- Not a feature request but surfaced during skill development
- Note: anthropics/claude-code has 10,305+ open issues (as of 2026-07-10)

## Notes

- These are **enhancements**, not blockers — contextus works well within current constraints
- Native aliasing would save ~400 tokens in contextus (8 aliases × 50 tokens)
- Argument autocomplete is primarily UX (doesn't affect functionality)
- Both would benefit the entire Claude Code plugin ecosystem, not just contextus
