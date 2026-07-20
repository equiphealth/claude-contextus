# Gap Analysis: Current Workflow vs Contextus

Comparison between your existing hooks + memory system and what contextus v1 provides. Written 2026-06-15 for dogfooding migration planning.

---

## Current Setup Inventory

### Skills (Global, ~/.claude/skills/)
- `/memory-reminder` — Post-work checklist, proposes memories (documentation claims auto-invoke, but unclear if actually implemented)
- `/investigation-complete` — Investigation→docs decision tree, creates memories/docs
- `/work-complete` — Unified: investigation-complete + productivity tracking
- `/create-memory` — Memory creation workflow (validation, dedup, structure)
- `/create-doc` — Comprehensive doc creation
- `/audit-memory` — Review memories for staleness/duplicates
- `/lint`, `/refactor-symbol` — Dev tools (unrelated to memory/context)

### Memory System
- `.claude/memory/` — Flat structure, frontmatter with `type:` and `tags:`
- `MEMORY.md` — Index of all memories
- Types: feedback, reference, decision, project
- **No automatic injection** — memories are read when Claude is reminded or searches

### Hooks
- **None found in `~/.claude/hooks.json`** — skills are explicitly invoked, not hook-driven

---

## Contextus v1 Capabilities

### Core Features
✅ **Proactive injection** — Patterns automatically retrieved and injected based on semantic similarity  
✅ **Semantic search** — Embeddings + vector search (Ollama/Transformers.js)  
✅ **Chunking** — Large docs split into retrievable chunks  
✅ **Hit tracking** — Used patterns get boosted in re-ranking  
✅ **Incremental re-embed** — Edit a context file → automatic re-embedding  
✅ **Calibration** — Quality measurement (is injected context actually used?)  
✅ **Multi-source** — Can ingest `.claude/context/`, `docs/`, `~/.contextus/context/`, `~/.contextus/docs/`  

### Hooks (Automatic)
✅ `SessionStart` → `session-start-hook.js` — Ensure daemon running, auto-reconcile corpus  
✅ `UserPromptSubmit` → `query-hook.js` — Retrieve and inject relevant context  
✅ `UserPromptSubmit` → `awareness-hook.js` — Propose new patterns in footer  
✅ `PostToolUse` → `watch-contexts.js` — Incremental re-embed on file edits  
✅ `Stop` → `stop-evaluation.js` — Quality evaluation (if calibration enabled)  

### Capture Mode (`plugin.json` config.contextCapture.mode)
- `silent` — No capture prompts (suppresses footer)
- `propose` — **(v1 default)** Append footer: `Context: propose: <topic>` + suggest `/create-context`
- `auto` — **(v2 planned)** Automatically invoke `/create-context` without asking

**Current state:** v1 only implements `silent` and `propose`. The `auto` mode exists in types but is treated as `propose` in the awareness hook (comment: "v2 concern").

---

## Side-by-Side Comparison

| Feature | Your System | Contextus v1 | Notes |
|---------|-------------|--------------|-------|
| **Memory storage** | `.claude/memory/` flat | `.claude/context/` organized by type | Similar structure, slightly different schema |
| **Memory types** | feedback, reference, decision, project | Same | Contextus adds automatic hit_count tracking |
| **Frontmatter** | `type:`, `tags:` (top-level or nested) | `metadata.type`, `metadata.tags` (nested) | Migration script normalizes this |
| **Index file** | `MEMORY.md` | `CONTEXT.md` | Same concept |
| **Retrieval** | Manual (explicit search/reminder) | **Automatic** (semantic injection) | 🆕 Key difference |
| **Embedding** | None | Ollama/Transformers.js nomic 768-dim | 🆕 New |
| **Chunking** | None (whole-file) | Header-split + token-fallback | 🆕 New |
| **Capture prompt** | Skills (`/memory-reminder`) | **Automatic** footer (awareness hook) | Both need explicit `/create` invocation |
| **Auto-invoke creation** | ❌ Aspirational in docs, not implemented | ❌ v2 feature (`auto` mode) | Neither system has this yet |
| **Hit tracking** | None | ✅ Automatic (boosts frequently-used patterns) | 🆕 New |
| **Incremental updates** | Manual re-embed | ✅ Automatic (watch hook) | 🆕 New |
| **Quality measurement** | None | ✅ Calibration (Haiku evaluation) | 🆕 New |
| **Investigation docs** | `/investigation-complete` skill | ❌ Not covered | Keep your skill |
| **Productivity tracking** | `/work-complete` skill | ❌ Not covered | Keep your skill |
| **Memory creation** | `/create-memory` skill | ❌ Not covered (needs your skill or equivalent) | Keep your skill |
| **Memory audit** | `/audit-memory` skill | ❌ Not covered | Adapt to audit `.claude/context/` |

---

## What Contextus Replaces

✅ **Manual memory lookup** → Automatic semantic injection  
✅ **Manual memory reminder** → Automatic awareness footer  
✅ **Manual corpus rebuild** → Incremental re-embed on edits  
✅ **Flat memory structure** → Organized + chunked + embedded corpus  

---

## What Contextus Does NOT Replace

❌ **Memory/doc creation flow** → Still need `/create-memory` or `/create-context`  
❌ **Investigation→docs workflow** → Still need `/investigation-complete`  
❌ **Productivity tracking** → Still need `/work-complete`  
❌ **Comprehensive docs** → Still need `/create-doc`  
❌ **Memory audit/maintenance** → Still need `/audit-memory` (adapt for `.claude/context/`)  
❌ **Auto-invoke creation** → v2 feature, not in v1  

---

## Key Behavioral Differences

### Your Current System (Skill-Based)
```
User: "Fixed the bug"
Claude: [explicitly invokes /memory-reminder]
  → Runs checklist
  → Proposes: "Context: propose: bug-fix-pattern"
  → (Aspires to auto-invoke /create-memory, but doesn't actually do it)
User: "/create-memory bug-fix-pattern"
  → Memory created
```

### Contextus v1 (Hook-Based)
```
User: "Fixed the bug"
Claude: [awareness-hook runs automatically in background]
  → Footer appended: "Context: propose: bug-fix-pattern"
  → Suggests invoking /create-context
User: "/create-context bug-fix-pattern"
  → Context created

Next session:
User: "How do I fix X?"
Claude: [query-hook runs automatically]
  → Retrieves bug-fix-pattern (similarity 0.65)
  → Injects it into context
  → Response references the pattern
  → Footer: "Context: used: bug-fix-pattern"
```

**The reversal:** Your system is **proactive about capture** (skills auto-run checklists). Contextus is **proactive about retrieval** (hooks auto-inject context). Both are **reactive about the actual creation** (wait for user to invoke the creation skill).

---

## Migration Strategy

### ✅ Replace These
- **Memory reminder pattern** → Contextus awareness hook (automatic)
- **Manual memory lookups** → Contextus automatic injection
- **Manual rebuild** → Contextus incremental re-embed

### 🔧 Adapt These
- `/audit-memory` → Update to audit `.claude/context/` instead of `.claude/memory/`
- Memory references in other skills → Update paths from `.claude/memory/` to `.claude/context/`

### ✅ Keep These Unchanged
- `/create-memory` / `/create-context` — Contextus proposes, but creation needs a skill
- `/investigation-complete` — Comprehensive investigation docs
- `/work-complete` — Productivity tracking
- `/create-doc` — Full documentation creation
- `/lint`, `/refactor-symbol`, etc. — Dev tools unrelated to context

### 🆕 New Workflows
- `/context-status` — Check daemon health, corpus stats, calibration state
- `/context-calibrate --floor` — Tune injection floor from replayed prompts
- `/context-calibrate --start` — Begin quality evaluation campaign
- `/tag-context` — Add semantic tags to patterns (prepares for v2 CAE)

---

## Open Questions

### 1. Auto-Invoke Behavior
**Current:** Neither system auto-invokes `/create-memory`. Contextus has an `auto` mode in the type definition, but it's deferred to v2.

**Decision needed:** 
- Keep `propose` mode (manual creation) for v1?
- Or implement `auto` mode now (awareness hook invokes `/create-context` directly)?
- If implementing `auto`, what's the safety/confirmation pattern?

**Recommendation:** Ship v1 with `propose` (manual). Validate injection quality first before adding automatic capture. Auto-capture that injects poor patterns is worse than manual capture of good ones.

### 2. Skill vs Hook Tension
**Your system:** Skills are explicitly invoked when needed (clear intent)  
**Contextus:** Hooks run automatically (ambient, invisible)

**Hybrid approach:**
- Keep contextus hooks for retrieval (automatic injection is the core value)
- Keep skills for complex workflows (investigation-complete, work-complete)
- Decide: awareness hook (automatic footer) vs memory-reminder skill (explicit invoke)?

**Recommendation:** Let contextus awareness hook replace explicit memory-reminder invocations. The footer is lightweight and non-intrusive. Keep the complex workflow skills.

### 3. Memory vs Context Terminology
**Your system:** "memory" everywhere (`.claude/memory/`, `/create-memory`, MEMORY.md)  
**Contextus:** "context" terminology (`.claude/context/`, `/create-context`, CONTEXT.md)

**Migration impact:**
- Muscle memory (you type `/create-memory` not `/create-context`)
- Skill references (other skills might reference memory paths)
- Documentation (project CLAUDE.md, skill descriptions)

**Recommendation:** 
- Keep both skills during transition: `/create-memory` (legacy) and `/create-context` (new)
- Gradually shift to context terminology
- Or alias `/create-memory` to `/create-context` for continuity

---

## V2 Features That Close Gaps

These are planned for v2 and would address current limitations:

| Gap | V2 Solution | Status |
|-----|-------------|--------|
| No auto-invoke creation | `contextCapture.mode: "auto"` | Typed but not implemented |
| Absolute floor is fragile | Top-K + relative-separation gating | Designed, not built |
| No per-category tuning | Per-category retrieval config | Designed, not built |
| Tags are inert | Tag-driven gating via CAE | Designed, not built |
| No rejection feedback | Removal/governance from usage data | Designed, not built |

---

## Coexistence Strategy

Run both systems in parallel initially:

### Week 1-2: Dual-Boot
- **Keep** `.claude/memory/` (read-only, reference)
- **Keep** all existing skills
- **Add** contextus (via `--plugin-dir`)
- **Migrate** memories → `.claude/context/`
- **Observe** what contextus injects vs what you manually look up

### Week 3-4: Contextus Primary
- **Disable** manual memory-reminder invocations (let awareness hook handle it)
- **Start** creating new patterns in `.claude/context/`
- **Keep** `.claude/memory/` for historical reference
- **Run** calibration to tune floor

### Week 5+: Full Migration
- **Archive** `.claude/memory/` (stop updating it)
- **Update** `/audit-memory` to work with `.claude/context/`
- **Commit** to contextus as primary pattern storage
- **Document** learnings for v2

---

## Risk Mitigation

### Rollback Plan
If contextus doesn't work:
1. Disable hooks: rename `hooks/hooks.json` to `hooks/hooks.json.disabled`
2. Restore skills: re-enable explicit `/memory-reminder` invocations
3. Keep using `.claude/memory/` as-is
4. Contextus data persists in `~/.contextus/data/` but won't be accessed

### Backup Strategy
Before migration:
```bash
# Backup current setup
cp -r .claude/memory .claude/memory.backup-$(date +%Y%m%d)
tar -czf ~/.claude-backup-$(date +%Y%m%d).tar.gz ~/.claude/memory ~/.claude/docs

# Migration is non-destructive
# /migrate-memory creates .claude/context/ but doesn't delete .claude/memory/
```

### Validation Checkpoints
- [ ] Daemon starts and loads model
- [ ] Query returns relevant results
- [ ] Injection appears in live session thinking
- [ ] Awareness footer proposes appropriate patterns
- [ ] Incremental re-embed triggers on file edit
- [ ] Floor tuning produces reasonable recommendation

---

## Success Metrics

How to know if migration is working:

### Quantitative
- **Injection rate**: 20-40% of prompts receive context (tune with floor)
- **Usage rate**: 50%+ of injections are actually used (check thinking blocks)
- **Hit tracking**: Frequently-used patterns rise in ranking over time
- **Response time**: <200ms query overhead, <5s session-start overhead

### Qualitative
- **Relevance**: Injected patterns are actually relevant to the query
- **Timeliness**: New patterns appear in future injections without manual lookups
- **Discoverability**: Forgot about a pattern? Contextus surfaces it when needed
- **Friction**: Creating patterns feels as easy as (or easier than) old system

### Red Flags
- **Over-injection**: Every prompt gets context, even trivial ones → floor too low
- **Under-injection**: Obvious relevant patterns don't inject → floor too high or corpus gaps
- **Wrong patterns**: Injected content is irrelevant → similarity model issue or bad corpus
- **Ignored context**: Injections appear but thinking never references them → bad retrieval or floor

---

## Timeline Estimate

### Prep (1-2 hours)
- Audit current hooks/skills
- Read migration guide
- Backup current setup
- Test contextus in its own repo

### Migration (2-4 hours)
- Run `/migrate-memory --apply`
- Embed corpus
- Load contextus via `--plugin-dir`
- Test in pilot project

### Coexistence (1-2 weeks)
- Use both systems in parallel
- Tune injection floor
- Identify gaps
- Build muscle memory for new workflows

### Commit (1 day)
- Disable old hooks
- Update skill references
- Archive old memory system
- Document lessons learned

**Total**: ~3 weeks from start to full migration

---

## Next Steps

1. **Finish v1** — Ensure all Phase 6 work is complete and tested
2. **Pilot test** — Dogfood contextus in the contextus repo itself
3. **Document findings** — What works? What doesn't? What's missing?
4. **Pick next project** — Choose a second project for migration
5. **Iterate** — Refine based on real usage before wide rollout

---

## Related Docs

- [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) — Step-by-step migration instructions
- [dev/V2_ROADMAP.md](dev/V2_ROADMAP.md) — What's coming after v1
- [dev/BUILD_LOG.md](dev/BUILD_LOG.md) — What was actually built in v1
- [dev/DESIGN.md](dev/DESIGN.md) — How contextus works under the hood
