I spent time reviewing this as both a system design and a product architecture document. Overall, this is substantially more mature than a typical design proposal. It demonstrates that you’ve already thought through lifecycle management, multi-project operation, migration, operational concerns, and long-term extensibility—not just retrieval.

Executive Assessment

Overall score: 8.5/10

Strongest aspects

- Clear separation from claude-mem
- Incremental migration strategy
- Good attention to operational realities (merge conflicts, stale embeddings, project isolation)
- Evolution from simple RAG to knowledge management platform
- Thoughtful multi-source architecture

Biggest concerns

1. Retrieval quality assumptions are optimistic
2. Embedding strategy is too coarse-grained
3. Context injection strategy will not scale as described
4. Query latency targets are unrealistic with current implementation
5. Some later sections contradict earlier architectural decisions

⸻

What Is Excellent

1. Separation From claude-mem

This is probably the strongest architectural decision.

You explicitly define:

System Purpose
claude-contextus Normative knowledge
claude-mem Observational history

That distinction is important.

A memory saying:

Use LoggerHelper for framework logging

is fundamentally different than:

User spent 4 hours debugging logging issues last week

Those should not live in the same retrieval system.

Many memory systems fail because they mix:

- rules
- documentation
- observations
- user preferences

into a single vector collection.

You avoided that.

⸻

2. Retrieval-First Instead Of Index-First

Moving away from:

MEMORY.md
→ scan manually
→ find memory
→ read memory

toward:

prompt
→ semantic retrieval
→ inject relevant memory

is the correct direction.

Once you exceed ~50 memories, manual index navigation becomes a bottleneck.

Your current system is already near that threshold.

⸻

3. Multi-Source Design

The later evolution into:

- projectMemory
- projectDocs
- userMemory
- userDocs

is much stronger than the original design.

This is where the system starts resembling a lightweight enterprise RAG architecture.

You recognized that:

patterns

and

documentation

have different retrieval value.

That matters.

Example:

Prompt:

Why is my WDIO test timing out?

Relevant sources might be:

Project memory:

- testing pattern

Project docs:

- test infrastructure guide

User memory:

- known timing issue

Combining them is powerful.

⸻

4. Read-Only Custom Sources

This is one of the best decisions in the document.

The rule:

Custom sources are retrievable but not writable.

prevents massive future problems.

Without that:

Child project could accidentally mutate parent knowledge.

That becomes a governance nightmare.

Your ownership model is clean:

Source Read Write
Project Yes Yes
User Yes Yes
Parent Yes No
Sibling Yes No
Framework Yes No

Excellent.

⸻

Major Technical Concerns

1. File-Level Embeddings Are Too Large

This is the biggest issue.

Current proposal:

# 1 memory file

1 embedding

That works only if memories remain tiny.

Once memories become:

feedback_logger.md
500-2000 words

the embedding becomes an average of everything.

You lose precision.

Example:

Memory contains:

- logging patterns
- exception handling
- structured metadata
- telemetry

Prompt:

How do I add request IDs?

Embedding may retrieve poorly because the vector represents all four topics.

⸻

Recommendation

Chunk memories.

Instead of:

# 64 files

64 vectors

Use:

# 64 files

300-800 vectors

Store:

{
"source": "feedback_logger.md",
"chunk": 4,
"heading": "Request Correlation IDs"
}

Then retrieve chunks.

This dramatically improves recall.

⸻

2. Top-K Memory Injection Is Dangerous

Current flow:

retrieve 5 memories
inject entire memory contents

This eventually explodes.

Imagine:

5 memories
× 1200 tokens
=
6000 tokens

You are now recreating the problem you tried to solve.

⸻

Better Pattern

Retrieve chunks:

Top 10 chunks

Then compress:

Memory A

- LoggerHelper preferred
- Never use console.log
  Memory B
- Capture screenshots on failure

Inject summaries, not raw documents.

Think:

Retrieval
→ Context Builder
→ Injection

not:

Retrieval
→ Dump Files

⸻

3. Similarity Threshold 0.7 Is Arbitrary

The document assumes:

threshold = 0.7

but thresholds vary wildly by model.

For MiniLM:

0.7 may be too high.

For OpenAI embeddings:

0.7 may be too low.

⸻

Recommendation

Use:

Top-K first

then adaptive filtering.

Example:

0.89
0.87
0.85
0.81
0.79
0.52

Keep top 5.

Don’t care about absolute threshold.

Relative ranking is usually more stable.

⸻

4. Query Latency Target Is Unrealistic

Target:

<100ms

Not with:

embed prompt
query chroma
read files
format injection

especially if using Xenova locally.

Realistically:

Stage Time
Embedding 50-300ms
Chroma 5-20ms
Read files 5-30ms
Formatting 1-5ms

Expected:

100-500ms

which is still acceptable.

I’d revise the goal.

⸻

Architectural Contradictions

There are several places where the document evolved but old sections weren’t fully updated.

⸻

Chroma Storage Strategy Changes

Early sections say:

.claude/memory-db/
committed to git

Later sections say:

~/.contextus/data/{project}

These are fundamentally different architectures.

You should pick one.

I strongly agree with the later decision.

Reasons:

- no merge conflicts
- no binary artifacts in repo
- user-specific configuration
- simpler rebuild story

I’d remove the git-committed database concept entirely.

⸻

File Mode vs Server Mode

Originally:

File-based only

Later:

Optional server mode

This is fine, but the document now treats them almost equally.

I would explicitly state:

Officially Supported

File Mode

Advanced Users

Server Mode

Otherwise you’ll end up testing both forever.

⸻

Missing Pieces

1. Re-ranking Layer

Current retrieval:

Prompt
→ Embedding
→ Top K

Modern RAG systems increasingly do:

Prompt
→ Embedding
→ Top 20
→ Re-rank
→ Top 5

Even a lightweight reranker can dramatically improve precision.

Not required for v1.

But I’d add it to future roadmap.

⸻

2. Memory Freshness Scoring

You discuss stale memories.

But retrieval currently ignores freshness.

Imagine:

WDIO pattern from 2024
WDIO pattern from 2026

Both match semantically.

The newer one should win.

Metadata ranking could be:

score =
semantic_similarity \* 0.8

- freshness \* 0.2

⸻

3. Memory Usage Feedback

This is a huge opportunity.

You already have:

Memory used:
Memory propose:

in the footer concept.

You could eventually learn:

Retrieved 5 memories
Claude used 2
Ignored 3

That becomes training data.

Over time retrieval quality improves.

⸻

Product-Level Concerns

The “Automatic Memory Creation” Risk

I strongly agree with your eventual choice:

propose

instead of

auto

as default.

Auto-generated memories are how knowledge bases become junkyards.

The proposal workflow:

Claude suggests memory
Human approves
Memory created

keeps quality high.

That decision will save enormous cleanup effort later.

⸻

What I Would Change Before Implementation

Phase 1

Implement:

- chunked embeddings
- file mode only
- project DB in ~/.contextus
- top-k retrieval

Do NOT implement:

- auto-discovery
- server mode
- vector abstraction
- collaborative features

Yet.

⸻

Phase 2

Add:

- chunk summarization
- reranking
- retrieval diagnostics

⸻

Phase 3

Add:

- custom sources
- parent repositories
- source weighting

⸻

Final Verdict

The document has evolved from “add embeddings to MEMORY.md” into a fairly sophisticated knowledge retrieval and memory management platform.

The strongest design decisions are:

- separation from claude-mem
- multi-source architecture
- read-only custom sources
- project-isolated databases
- proposal-first memory creation

The biggest architectural improvement I’d make immediately is:

Move from file-level retrieval to chunk-level retrieval before writing the first production embedding pipeline.

If you make only one change based on this review, make that one. It will have a larger impact on retrieval quality than Chroma vs Qdrant, server vs file mode, threshold tuning, or any other implementation detail in the document.
