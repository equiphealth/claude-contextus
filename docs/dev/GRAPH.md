# Evolving Claude Contextus into a Local Context Graph

## Core Idea

Claude Contextus could evolve into a **local context graph across related repositories**.

The important distinction is that the graph should **not replace retrieval** and should not become a general-purpose knowledge graph.

Instead:

> A graph of development context, where repositories, files, patterns, decisions, and sessions can be connected and retrieved together.

This fits what Contextus already does well: **proactive context injection**.

Today, Contextus is roughly:

    Repository
       │
       ├── context sources
       ├── patterns
       ├── user context
       └── linked projects
              │
              ▼
          retrieval
              │
              ▼
        ranked context
              │
              ▼
           Claude

A graph adds relationships:

                        ┌──────────────┐
                        │   Project A  │
                        │  contextus   │
                        └──────┬───────┘
                               │
                        depends-on
                               │
                               ▼
                        ┌──────────────┐
                        │   Project B  │
                        │ vector-tools │
                        └──────┬───────┘
                               │
                         shares-pattern
                               │
                               ▼
                        ┌──────────────┐
                        │  Pattern X   │
                        │ embeddings   │
                        └──────┬───────┘
                               │
                           referenced-by
                               │
                               ▼
                        ┌──────────────┐
                        │  File Y      │
                        └──────────────┘

The graph gives retrieval **structure and relationships** without becoming the product itself.

---

# 1. Data Model

Keep the initial model surprisingly small.

Only four primary node types are necessary:

    Project
    Source
    Pattern
    Session

A `Source` can represent:

    markdown file
    code file
    README
    PR
    issue
    decision
    configuration
    linked context

There does not need to be a separate database entity for every source type.

Example TypeScript model:

    interface ContextNode {
      id: string
      type: "project" | "source" | "pattern" | "session"

      projectId: string

      path?: string
      title?: string

      contentHash?: string

      embedding?: number[]

      metadata?: Record<string, unknown>
    }

Edges can remain simple:

    interface ContextEdge {
      from: string
      to: string

      type:
        | "contains"
        | "references"
        | "depends-on"
        | "related-to"
        | "derived-from"
        | "shared-with"

      weight?: number

      source?: string
    }

That's enough to start.

There is no need for:

- Neo4j
- RDF
- Cypher
- a graph database
- a graph query language
- a graph UI

A local JSONL or SQLite representation should be sufficient.

---

# 2. Projects Become First-Class Graph Nodes

This makes the existing `link-project` functionality much more interesting.

Currently:

    Project A
       │
       └── linked → Project B

The graph turns that into:

    Project A
       │
       ├── contains → Pattern A1
       ├── contains → Pattern A2
       │
       └── related-to → Project B
                             │
                             ├── Pattern B1
                             └── Pattern B2

Eventually:

    Project A
        │
        ├── depends-on ──────► Project B
        │                         │
        │                         └── Pattern X
        │
        └── shares-pattern ───► Pattern X

The distinction is valuable.

A project isn't merely another source of text.

It is a **contextual boundary**.

---

# 3. Retrieval Should Become Two-Stage

This is probably the most important architectural decision.

**Do not turn graph traversal into the retrieval mechanism.**

Instead:

             User request
                  │
                  ▼
          semantic retrieval
                  │
                  ▼
          initial candidates
                  │
                  ▼
          graph expansion
                  │
                  ▼
        related candidates
                  │
                  ▼
          final reranking
                  │
                  ▼
         context injection

For example, Claude is working on:

    "Fix the embedding pipeline."

Semantic search might find:

    Pattern:
    "Embedding jobs must be idempotent"

    Source:
    lib/embedding/queue.ts

    Project:
    contextus

The graph can then expand:

    embedding queue
          │
          ├── references → embedding config
          │
          ├── related-to → usage evaluation
          │
          └── depends-on → vector-inspector

Now Contextus has a reason to retrieve something from Vector Inspector even if its semantic similarity wasn't particularly high.

That is the real benefit of the graph.

---

# 4. Graph Expansion Should Be Tiny

The first implementation should have very conservative traversal.

Something like:

    semantic search
         │
         └── top 5
               │
               └── expand 1 hop
                     │
                     └── top related nodes

Do not start with:

    start node
       ↓
    everything connected
       ↓
    everything connected to those
       ↓
    ...

That becomes graph explosion very quickly.

A candidate could eventually receive a score such as:

    finalScore =
        semanticScore * 0.70
      + graphScore    * 0.20
      + sourceScore   * 0.10

But even that may be more complexity than necessary initially.

A simpler V1 could use:

    finalScore =
        semanticScore + graphBonus

The graph is primarily providing **additional context candidates**, not replacing semantic relevance.

---

# 5. Cycle Handling

Graphs introduce cycles naturally.

For example:

    A → B
    B → C
    C → A

Or:

    Contextus
       ↓
    Vector Inspector
       ↓
    Contextus

There is no need for sophisticated cycle detection.

Use a visited set:

    const visited = new Set<string>()

    function expand(node, depth) {
      if (depth > MAX_DEPTH) return
      if (visited.has(node.id)) return

      visited.add(node.id)

      for (const edge of edges(node)) {
        expand(edge.target, depth + 1)
      }
    }

For the first version:

    MAX_DEPTH = 1

That almost completely eliminates the practical problem.

Even if traversal eventually reaches depth 2, impose hard limits:

    max depth = 2
    max nodes expanded = 20

Contextus does not need to solve arbitrary graph traversal.

---

# 6. Source Attribution

This is one area where the graph should be **more explicit than a normal vector database**.

Every retrieved piece should be able to answer:

> "Why did Contextus give me this?"

For example:

    Pattern: Embedding jobs must be idempotent

    Source:
    contextus/lib/embedding/queue.ts

    Why retrieved:
    Semantic match: 0.87
    Graph relationship:
      contextus/lib/embedding/queue.ts
          └── related-to
      contextus/lib/evaluation/worker.ts

    Project:
    contextus

Or:

    Source:
    vector-inspector/docs/embedding.md

    Why retrieved:
    Linked project → vector-inspector
    Related to:
    contextus/lib/embedding/

This is enormously useful for debugging the retrieval system.

Especially because Contextus already has the **usage feedback loop**.

Eventually you can know:

    retrieved
       ↓
    injected
       ↓
    used?
       ↓
    rating

Now Contextus can ask:

    Which graph relationships actually improve context quality?

That's much more interesting than simply measuring embedding similarity.

---

# 7. The Graph Should Not Require LLM-Generated Relationships

Be careful about automatically asking an LLM to connect everything.

Avoid:

    LLM:
    "I think these two files are related."

for every possible pair.

That becomes:

- expensive
- noisy
- opaque
- difficult to debug
- difficult to maintain

Instead, create relationships from things that can be established deterministically.

### Files

    same project
    same directory
    references same file
    imports module

### Projects

    explicitly linked
    dependency
    shared context directory

### Patterns

    derived from source
    same tags
    same source

### Sessions

    used pattern
    modified source
    created pattern

LLM-generated relationships can eventually exist as:

    related-to

but they should initially be treated as **low-confidence edges**.

---

# 8. Existing `link-project` Is the Perfect Starting Point

This is why the graph fits Contextus rather than being a random feature bolted onto it.

Contextus already has:

    pnpm link-project <path>

Currently, that effectively means:

    "Search this other corpus too."

The graph could eventually mean:

    "These projects belong to the same local context universe."

For example:

    ~/dev/
    ├── claude-contextus/
    ├── vector-inspector/
    ├── some-app/
    └── shared-lib/

Contextus could represent:

    claude-contextus
          │
          ├── linked → vector-inspector
          │
          ├── linked → some-app
          │
          └── linked → shared-lib

Retrieval can then cross repository boundaries **only when the graph gives it a reason**.

That is much better than dumping every repository into one giant vector corpus.

---

# 9. A Very Small V1

The first version should be almost embarrassingly small.

### Add one local graph store

Something like:

    ~/.contextus/data/
        graph.jsonl

Example:

    {
      "type": "edge",
      "from": "project:contextus",
      "to": "project:vector-inspector",
      "relation": "linked"
    }

Another:

    {
      "type": "edge",
      "from": "pattern:abc123",
      "to": "source:contextus/lib/embedding.ts",
      "relation": "derived-from"
    }

The graph can mostly contain **references to things Contextus already knows about**.

You don't need to duplicate the underlying context content.

---

# 10. V1 Retrieval Flow

The retrieval algorithm could be:

    1. Search the current project normally.

    2. Get the top N candidates.

    3. For each candidate:
         find graph neighbors.

    4. Add those neighbors as additional candidates.

    5. Give graph-expanded candidates a small bonus.

    6. Deduplicate.

    7. Rerank.

    8. Inject context.

Example:

    Query
      │
      ▼
    semantic search
      │
      ├── Pattern A  .91
      ├── Source B   .86
      └── Pattern C  .82
            │
            ▼
        graph expansion
            │
            ├── Source D .78 + graph bonus
            ├── Pattern E .74 + graph bonus
            └── Project F

No graph UI.

No graph editor.

No graph visualization.

No new daemon.

No new LLM.

No new embedding system.

No graph database.

Just **graph-aware retrieval**.

---

# 11. Retrieval Results Should Carry Reasons

The internal retrieval result could look something like:

    interface RetrievalResult {
      nodeId: string
      score: number

      semanticScore?: number
      graphScore?: number

      reasons: RetrievalReason[]
    }

    interface RetrievalReason {
      type:
        | "semantic"
        | "linked-project"
        | "graph-neighbor"
        | "dependency"
        | "source-reference"

      from?: string
    }

That eventually enables something like:

    /contextus explain <pattern>

    Score: 0.84

    Semantic:       0.71
    Graph:          +0.10
    Project:        +0.03

    Related through:
      contextus/lib/embedding.ts
          → related-to
      vector-inspector/src/index.ts

This would be extremely useful when tuning Contextus.

---

# 12. The More Interesting Long-Term Direction

The really interesting evolution isn't necessarily "knowledge graph."

It is **context propagation**.

Imagine:

    Project A
       │
       │ modifies
       ▼
    Source X
       │
       │ derived pattern
       ▼
    Pattern P
       │
       │ used successfully
       ▼
    Session S

Now Contextus can eventually learn:

> Pattern P tends to be useful when working on Source X in Project A.

Then another project might share a relationship:

    Project B
       │
       └── shares dependency with A
                  │
                  ▼
             Pattern P

Now context can propagate across repositories.

That gets very close to the larger goal of Contextus:

> Not remembering everything, but recognizing when previously learned context becomes relevant again.

---

# 13. Architectural Boundary

This distinction should be protected:

                         Contextus
                            │
               ┌────────────┴────────────┐
               │                         │
          Context Store              Context Graph
               │                         │
        "What do I know?"          "What is related?"
               │                         │
               └────────────┬────────────┘
                            │
                        Retrieval
                            │
                      "What matters
                       right now?"

The graph should **never become the product**.

It should be an internal mechanism that improves the product.

That is how to avoid Contextus turning into:

    Neo4j
      +
    ontology engine
      +
    agent platform
      +
    knowledge management system
      +
    visualization application

The graph should remain an implementation detail that makes Contextus better at choosing context.

---

# 14. Suggested First PR

If this were the next Contextus PR, I would make it something like:

## PR: Graph-Aware Linked-Project Retrieval

### 1. Introduce edges

Start with:

    project → project
    pattern → source
    source → source

### 2. Persist edges locally

Use JSONL or SQLite, whichever fits the existing persistence model better.

### 3. Automatically create only deterministic edges

Especially:

    link-project
    imports/references
    pattern source

### 4. Add one-hop expansion

    semantic candidates
            ↓
    graph neighbors
            ↓
         rerank

### 5. Add retrieval reasons

Make it possible to see **why** something crossed the repository boundary.

### 6. Feed graph-derived candidates into the existing usage evaluator

This is arguably the most important part.

Then Contextus can compare:

                         Context quality
                              │
                 ┌────────────┴────────────┐
                 │                         │
           semantic-only             graph-expanded

If graph-expanded context consistently gets better usage scores, then there is evidence that the graph deserves to grow.

If it doesn't, Contextus has learned that the added complexity isn't helping.

---

# 15. What Not to Build Yet

Do NOT build these as part of V1:

- Graph database
- Graph visualization
- Graph editor
- Ontology system
- LLM-generated graph construction
- Arbitrary multi-hop traversal
- Cross-machine graph synchronization
- Cloud graph storage
- Graph-specific embedding models
- Graph query language
- New daemon
- New configuration system
- New CLI unless needed for debugging
- New UI

The graph should be almost invisible.

Users should mostly experience:

> "Contextus somehow knew that this other repository was relevant."

---

# 16. Why This Fits Contextus

Contextus already has several pieces that make this direction unusually natural:

    Markdown/context sources
            │
            ▼
       multi-source loading
            │
            ▼
       linked projects
            │
            ▼
       semantic retrieval
            │
            ▼
       context injection
            │
            ▼
       usage evaluation

The graph becomes a relationship layer:

    Markdown/context sources
            │
            ▼
       multi-source loading
            │
            ├───────────────┐
            ▼               ▼
       linked projects   relationships
            │               │
            └───────┬───────┘
                    ▼
             semantic retrieval
                    │
                    ▼
             graph expansion
                    │
                    ▼
                reranking
                    │
                    ▼
             context injection
                    │
                    ▼
             usage evaluation
                    │
                    ▼
              feedback loop

That makes the graph an extension of the existing architecture rather than a new architecture.

---

# 17. The Big Idea

The strongest version of this concept is not:

> "Contextus stores a knowledge graph."

It is:

> **Contextus understands that your repositories are connected, and uses those relationships to retrieve context that semantic search alone would miss.**

That is a much smaller and more compelling product.

The graph answers:

    "What is related?"

Semantic search answers:

    "What sounds relevant?"

Usage evaluation answers:

    "Was it actually useful?"

Together:

    Graph
      ↓
    relationships

    Semantic retrieval
      ↓
    relevance

    Usage feedback
      ↓
    usefulness

    Contextus
      ↓
    "What context should I inject right now?"

---

# 18. Recommended Evolution

A sensible progression would be:

### Phase 1 — Deterministic Graph

    Projects
    Sources
    Patterns

    +
    
    linked-project edges
    source/reference edges
    pattern/source edges

    +
    
    one-hop graph expansion

No new intelligence yet.

---

### Phase 2 — Graph-Aware Scoring

Add:

    graph distance
    relationship type
    graph confidence
    project relationship strength

Then:

    semantic score
          +
    graph bonus
          =
    final retrieval score

Use the existing usage evaluator to measure whether this improves results.

---

### Phase 3 — Learned Relationships

Only after the deterministic graph proves useful:

    usage feedback
          ↓
    successful relationships
          ↓
    relationship weighting

Eventually:

    "This pattern is repeatedly useful
     across these two projects."

That is where Contextus starts developing something genuinely interesting.

---

### Phase 4 — Context Propagation

Eventually the graph could support:

    Project A
       │
       └── Pattern P
              │
              └── useful in Project B

Contextus can then discover that a piece of context learned in one repository is relevant in another.

That is the point where a "local context graph" becomes much more than a fancy dependency map.

---

# Final Recommendation

I would pursue this, but **very narrowly**.

The first implementation should be:

    Existing Contextus
          +
    local graph of deterministic relationships
          +
    one-hop expansion
          +
    graph-aware reranking
          +
    retrieval attribution
          +
    existing usage feedback

Nothing more.

The graph should be a **small local relationship index**, not a platform.

The strongest architectural principle should be:

> **Semantic retrieval finds candidates. The graph finds connections. Usage feedback decides whether those connections were actually valuable.**

That gives Contextus a potentially powerful new capability while preserving the simplicity of the project.