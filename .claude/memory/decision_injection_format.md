---
name: injection-format
description: User message prepend with bracketed framing for context injection
metadata:
  type: decision
---

**Decision**: Inject retrieved context as **user message prepend** with bracketed framing.

**Format**:
```
[Retrieved from your project's context patterns - reference these if relevant]

---
**logger-helper.md** (similarity: 0.87, used 12 times)
Log retry attempts for debugging flaky tests...

---
**test-data-setup.md** (similarity: 0.81, used 9 times)
Use fixtures to isolate test state...

---

{user's actual prompt}
```

**Why user message prepend > system prompt append**:
- ✅ **Front-loaded**: Context appears before question (primacy effect, better attention)
- ✅ **Clear framing**: Bracket distinguishes retrieved resources from user's words
- ✅ **Closer to prompt**: Spatially near the question it's meant to answer
- ✅ **Visible to thinking**: Claude will naturally reference "the retrieved context patterns"
- ✅ **User message gets more attention** than system prompt in practice

**Why bracket is critical**:
- Prevents confusion about what user is asking vs what was retrieved
- Sets expectation: "reference *if relevant*" (not "you must use these")
- Makes obvious this is injected, not user-written

**Metadata included**:
- Similarity score (from vector search)
- Hit count (retrieval frequency tracking)
- Pattern title/filename

**Validation**: Early POC should check thinking blocks to confirm Claude references context naturally (e.g., "Looking at the retrieved patterns, logger-helper.md shows..."). If not, may need to adjust framing.

**Alternatives rejected**:
- System prompt append: Less attention, further from question
- XML tags: More verbose, no proven benefit
- No framing: Risk of confusion between user intent and injected context

**Related**: [[evaluation-architecture]], [[token-budget]]
