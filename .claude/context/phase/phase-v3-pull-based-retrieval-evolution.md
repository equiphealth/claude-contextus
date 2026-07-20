---
name: v3-pull-based-retrieval-evolution
description: V3+ architectural evolution toward pull-based retrieval alongside current push injection
metadata:
  type: phase
  tags: ["v3", "architecture", "j-space", "retrieval"]
---

# V3+ Evolution: Pull-Based Retrieval

## Current State (V1/V2): Push-Based Injection

Contextus proactively injects context via UserPromptSubmit hook:
- Embed user prompt
- Semantic search against corpus
- Inject top-k matches into context window
- Model receives context passively

**Architecture:** Daemon HTTP API (`/query`, `/capture`, `/health`) + LanceDB vector store

## J-Space Research Implications

Anthropic's "Global Workspace" research (2026) reveals:
- Models have limited deliberative workspace ("few dozen concepts at once")
- Models can report on internal state (what they're thinking about)
- Models can deliberately activate specific patterns (controllability)
- Models can recognize knowledge gaps before expressing them

**Implication:** Future models will be more proactive about requesting specific information rather than passively receiving injected context.

## V3+ Direction: Hybrid Push + Pull

### Current Capability (Already Exists)

The daemon HTTP API is already queryable. Claude can pull specific information via direct HTTP calls:

```bash
# Semantic search (current /query endpoint)
curl -X POST http://localhost:37800/query \
  -H 'Content-Type: application/json' \
  -d '{"project":"contextus","prompt":"architecture patterns","topK":3}'

# Pattern capture (current /capture endpoint)
curl -X POST http://localhost:37800/capture \
  -H 'Content-Type: application/json' \
  -d '{"slug":"example","category":"decision","body":"...","cwd":"/path/to/project"}'
```

**Key insight:** The architecture already supports pull-based retrieval. Models just need to know the endpoints exist and when to use them.

### Expanded API Surface (V3+)

To support richer pull-based retrieval, expand daemon endpoints:

```bash
# Structured queries
GET  /patterns?tags=architecture,decisions&category=arch&after=2026-01-01
GET  /pattern/{id}  # Direct pattern retrieval by ID
GET  /patterns/related?from={id}&depth=2  # Relationship traversal
GET  /patterns/by-usage?min-hits=5&sort=recent  # Usage-based discovery
POST /search/structured  # Complex query DSL
```

### Access Patterns

**Push (current, continues in V3+):**
- Common patterns everyone needs
- High-relevance baseline context
- Broad semantic matches
- Injected on every prompt via UserPromptSubmit hook

**Pull (V3+, model-initiated):**
- Specific information gaps model recognizes
- Follow-up queries during deliberation
- Relationship traversal ("what's related to X?")
- Targeted retrieval based on task needs

**Example hybrid workflow:**
```
1. User: "How does the daemon work?"
2. Push: Contextus injects arch/arch-daemon.md (0.82 similarity)
3. Model reads injection, recognizes gap about port configuration
4. Pull: Model queries /pattern/decision-daemon-port-assignment directly
5. Model synthesizes answer from both sources
```

## Implementation Considerations

### Authentication & Authorization
- Which patterns can model vs. user vs. CI access?
- Per-project scoping (already implemented in unified DB)
- Rate limiting to prevent runaway retrieval loops

### Observability
- Log what the model pulled, when, why
- Distinguish user-requested vs. model-initiated retrieval
- Usage tracking extends to pull queries (not just injected patterns)

### Caching
- Model may repeatedly pull same patterns during deliberation
- Response cache at daemon layer (already exists for /query)
- Session-scoped cache for frequently accessed patterns

### MCP Tool Exposure

Expose daemon endpoints as MCP tools for direct model access:

```typescript
// MCP tool definition
{
  name: "contextus_search",
  description: "Search project semantic corpus by tags, category, or text",
  parameters: {
    query: "string",
    tags: "string[]",
    category: "string",
    topK: "number"
  }
}
```

Models can then invoke these tools during conversation:
```
User: "How do we handle errors?"
Model: <thinking>I need error handling patterns</thinking>
Model: [calls contextus_search(tags=["error","gotcha"])]  
Model: Based on the error handling patterns...
```

## Why Current Architecture Already Supports This

1. **Daemon-based design** - HTTP API is the interface, not direct file access
2. **Project-scoped storage** - Unified LanceDB already handles multi-project isolation
3. **Semantic indexing** - Vector embeddings support both push and pull queries
4. **Stateless endpoints** - /query, /capture, /health are already callable by any client

**Key realization:** V3 isn't a rewrite. It's endpoint expansion + MCP tool wrappers around existing infrastructure.

## Validation from J-Space Research

- **Limited workspace capacity** - Push ensures baseline high-quality patterns reach J-space
- **Controllability** - Pull lets model deliberately activate specific patterns when recognized as needed
- **Reportability** - Model can explain why it requested specific information ("I needed error handling context")
- **Flexibility** - Single pattern serves multiple downstream tasks (architecture doc used for both design and debugging)

## Integration Constraint: Reactive Architecture

**Critical limitation:** Claude Code's hook system is fundamentally **reactive** (responds to user/system events) not **proactive** (model-initiated actions).

**Available hooks (all reactive):**
- `UserPromptSubmit` - fires when user sends message
- `SessionStart` - fires when session begins
- `Stop` - fires when turn ends
- No "background task" or "during-deliberation" hooks

**What this means:**
- Contextus can inject context when user acts (push model works)
- Model cannot proactively query daemon during deliberation
- No hook for "model recognizes knowledge gap and requests information"
- Plugin cannot offer "I have queryable endpoints available" without user trigger

**Why pull-based retrieval is blocked:**
1. Model might have capability (J-space awareness of knowledge gaps)
2. Daemon has infrastructure (queryable HTTP API)
3. But integration layer (hooks) doesn't support proactive model-to-plugin communication

**This is likely intentional design:**
- Keeps models reactive and controllable
- Prevents runaway loops (model queries → more questions → infinite recursion)
- User remains in control of when actions occur
- Simpler security/safety model

## Migration Path (Conditional on Platform Evolution)

V2 → V3 evolution **requires platform support** for proactive model actions:

**If Anthropic ships proactive capabilities:**

1. **Phase 1:** Expose existing /query endpoint as MCP tool for model use
2. **Phase 2:** Add structured query endpoints (/patterns, /pattern/{id}, /related)
3. **Phase 3:** Monitor usage patterns - does model pull what it needs? Or still over-rely on push?
4. **Phase 4:** Adjust injection floor based on pull availability (less push if model can pull reliably)

**Until then (current state):**
- Push-based injection remains primary mechanism
- Skills provide richer retrieval on explicit user request (`/ctx-search`)
- Daemon API documents potential future pull interface
- Architecture ready but integration-blocked

## Open Questions

- **When does model pull vs. rely on push?** Need heuristics for "I have enough context" vs. "I need more"
- **How to prevent pull loops?** Model requests pattern A, which references pattern B, which references C...
- **Cost model** - Pull queries cost tokens (tool calls). Is this cheaper than always-push?
- **Cache invalidation** - If corpus updates mid-session, does model know to re-pull?

## Relationship to Pending Corpus (V2)

V2 introduces pending corpus (ephemeral → pending → published). Pull-based retrieval interacts with this:

**Pull from published only (default):**
- Model sees only Git-committed, team-reviewed patterns
- Stable, authoritative information

**Pull from pending overlay (optional):**
- Model can access in-progress work before publish
- Useful for local development
- Requires clear "draft" vs. "published" distinction in responses

## References

- Anthropic Research: "A Global Workspace in Language Models" (2026)
- contextus V2 design spec: `docs/dev/V2_PENDING_CORPUS_AND_PUBLISH_WORKFLOW.md`
- Current daemon API: `daemon/server.ts`
- Unified DB architecture: `docs/dev/UNIFIED_DB_DESIGN.md`

