# Contextus Category & Tag Specification

### How to choose the correct context category, avoid overlap, decide when to create a new one, and how tags complement categories

This document defines the rules for assigning `.claude/context/` file categories, deciding when a new category is justified, and how **tags** provide a second semantic dimension. The goal is to keep the system semantically clean, retrieval-friendly, and fast — without slowing down the model or creating category bloat.

---

# 1. Core Principle

A category must describe the **semantic role** of the content, not the **method** of creation.

> **Ask: "What question should this answer when retrieved?" — not "What is this about?"**

Examples of invalid category logic:

- "This came from feedback" → describes provenance, not meaning
- "This was a thought I had" → describes origin, not semantics

Examples of valid category logic:

- "This is a resolved choice" → `decision-`
- "This is a pitfall" → `gotcha-`
- "This is a design tradeoff" → `tradeoff-`

This principle eliminates most ambiguity.

---

# 2. Categories vs Tags

Categories and tags serve different semantic purposes and must remain distinct. This two-axis system is the correct ontology for Contextus.

## 2.1 Categories — retrieval intent

Categories answer:

> **"What question should this file answer when retrieved?"**

They define the **semantic role** of the file. A file has **one category**.

Examples:

- `arch-` → "What is the structure?"
- `decision-` → "What did we choose?"
- `question-` → "What's still undecided?"
- `tradeoff-` → "Why did we choose it?"
- `gotcha-` → "What went wrong?"
- `project-` → "What are the ground rules?"

> **`question-` vs `decision-`.** A `question-` file is an OPEN question — a choice
> deliberately not yet made (options weighed, no verdict). It exists so the open
> question surfaces when you next work the area, instead of being silently re-discovered.
> When it's resolved, it becomes a `decision-` file (rename + rewrite as the chosen
> outcome) and the `question-` file is removed. Retrieval intent: inject when the user
> approaches the undecided area so they don't re-litigate from scratch. Keep these rare —
> a `question-` file is for a REAL fork worth remembering, not every passing "hmm".

## 2.2 Tags — content descriptors

Tags answer:

> **"What is this file about?"**

They define the **topic(s)** of the file. A file may have **many tags**.

Examples:

- `lancedb`
- `daemon`
- `chunking`
- `embedding`
- `hooks`
- `schema`
- `macos`

## 2.3 Frontmatter example

```markdown
---
name: gotcha-lancedb
description: LanceDB friction points during Phase 1
metadata:
  type: gotcha
  tags: [lancedb, schema, embedding]
---
```

## 2.4 Why both are needed

- Categories keep retrieval **precise**
- Tags keep retrieval **rich**
- Categories prevent semantic drift
- Tags prevent category explosion

When a new topic recurs, add a **tag** — not a category.

---

# 3. The Category Decision Framework

Use these rules in order. They resolve 95% of edge cases.

## Rule 1 — If the content answers "what is this?", use an existing category.

Examples:

- Architecture description → `arch-`
- API contract → `api-`
- Resolved choice → `decision-`
- Pitfall or friction → `gotcha-`
- Phase exit log → `phase-`
- Project-wide convention or constraint → `project-`

If it fits, **do not create a new category**.

## Rule 2 — If the content answers "why did we do it this way?", it is a tradeoff.

Use `tradeoff-` for:

- alternatives considered
- rejected designs
- reasoning
- constraints
- architectural justification

This absorbs many ambiguous cases that might otherwise create category sprawl.

## Rule 3 — Create a new category only if ALL THREE are true:

1. The content type **recurs**
2. It does **not** fit any existing category
3. It has a **distinct retrieval intent**

If any of these are false → use an existing category.

**Valid new category examples:**

- `security-` (if threat models recur)
- `perf-` (if performance analysis recurs)
- `schema-` (if data model structure recurs)

**Invalid new category examples:**

- `feedback-` (method, not meaning)
- `notes-` (too vague)
- `misc-` (garbage bucket)
- `idea-` (provenance, not semantics)

## Rule 4 — A category must define its retrieval behavior explicitly.

Every category should declare:

- **when** it is injected
- **how strongly** it is weighted
- whether it is **always-on or conditional**
- whether it **competes or merges** with others

Example:

```yaml
arch-:
  injection: always in architecture tasks
  weight: high
  scope: project-level only
```

Without this, categories slowly degrade into "folders with smart names."

---

# 4. The One-Sentence Test

When unsure:

**If you cannot explain why this content needs a different retrieval behavior, it does not need a new category.**

Retrieval behavior is the north star.

---

# 5. Architecture Tradeoffs and Multi-File Generation

Architecture decisions often contain **two different semantic roles**:

1. **The reasoning** behind the design
2. **The final shape** of the design

These are different knowledge types and must be split into **multiple context files**.

## 5.1 When to create multiple context files

If a single design event contains:

- "Why we chose this design" → reasoning
- "What the design is" → structure
- "What we finally decided" → normative choice

Then it must produce:

- a `tradeoff-*` file
- an `arch-*` file
- a `decision-*` file

This is intentional and required.

## 5.2 Why they must be separate

Because they have **different retrieval intents**:

| **Question**                   | **Should retrieve** |
| ------------------------------ | ------------------- |
| "Why is it designed this way?" | `tradeoff-*`        |
| "What is the design?"          | `arch-*`            |
| "What did we choose?"          | `decision-*`        |

Merging them would confuse re-ranking, pollute injection, mix reasoning with structure, and reduce retrieval precision. Contextus is a semantic system — separation is essential.

---

# 6. The Difference Between `arch-` and `decision-`

This distinction is subtle but extremely important.

## 6.1 `arch-` — *What the system is*

Use `arch-` for: component maps, data flow, system shape, pipeline descriptions, structural relationships.

It answers "What is the architecture?", "How does this component work?", "What is the system layout?" It is **descriptive**, not normative.

## 6.2 `decision-` — *What was chosen*

Use `decision-` for: resolved choices, fixed parameters, selected approaches, final outcomes of tradeoffs.

It answers "What did we decide?", "What is the chosen configuration?", "What is the final behavior?" It is **normative**, not descriptive.

## 6.3 Example: Daemon Port

- The **port number** is a *decision*, not architecture.
- The **daemon's structure** (endpoints, warm-load behavior, lifecycle) is architecture.

Thus:

- `tradeoff-daemon-port` → why 7891
- `decision-daemon-port` → final choice
- `arch-daemon` → how the daemon works

Three files, three roles, three retrieval behaviors.

---

# 7. The Difference Between `decision-` and `project-`

This distinction matters because `project-` files have a fundamentally different retrieval character.

## 7.1 `decision-` — *What was chosen*

A decision implies **agency** — something was weighed and a choice was made. It is relevant when the specific topic is active.

## 7.2 `project-` — *What was discovered*

A project convention is typically **found**, not made. The lock file revealed pnpm; the repo revealed a port convention; the codebase revealed a linting rule. No deliberation occurred — the constraint already existed.

`project-` answers: "What are this project's ground rules and conventions?"

It is **always-relevant** — it applies universally regardless of what task is active, not just when a specific topic comes up. This distinct retrieval character (broad, persistent applicability vs. topic-scoped) is what justifies it as its own category.

## 7.3 Example: Package Manager

- "We evaluated npm vs pnpm and chose pnpm" → `decision-`
- "The repo uses pnpm — always use pnpm commands" → `project-`

---

# 8. Tag Usage Rules

- No compound tags (e.g. `async-race-flaky` ❌) — use separate tags
- Tags must be reusable across categories
- A tag must influence retrieval or CAE decisions, or be removed
- Tags are not descriptive labels; treat them as behavioral constraints

> Tags also feed the **Context Applicability Evaluator** (CAE), which uses them as semantic constraint modifiers during injection gating. See [CONTEXT_APPLICABILITY_EVALUATOR.md](CONTEXT_APPLICABILITY_EVALUATOR.md) for the tag ontology seed set and how tag alignment affects scoring.

---

# 9. Practical Edge Case Examples

| Situation | Category |
| --- | --- |
| "We discovered LanceDB can't migrate dimensions." | `gotcha-lancedb` |
| "We considered chunking at 256 vs 512." | `tradeoff-chunking` |
| "We decided to fix the daemon port at 7891." | `decision-daemon-port` |
| "We need to describe the hook stdin/stdout contract." | `api-hooks` |
| "We need to describe the embedding pipeline." | `arch-embedding` |
| "The repo uses pnpm — always use pnpm commands." | `project-package-manager` |
| "We need to describe the LanceDB table schema." | `schema-lancedb` **if** schema knowledge recurs |

---

# 10. Meta-Rule

**Choose the category that best supports retrieval, not the one that best describes your workflow.**

Contextus is a semantic system, not a diary.

---

# 11. Summary Table

| **Question**                                               | **Category** |
| ---------------------------------------------------------- | ------------ |
| What is this component?                                    | `arch-`      |
| What decision was made?                                    | `decision-`  |
| What went wrong?                                           | `gotcha-`    |
| Why did we choose this design?                             | `tradeoff-`  |
| What is the API contract?                                  | `api-`       |
| What happened in this phase?                               | `phase-`     |
| What are this project's ground rules?                      | `project-`   |
| Does this recur, not fit above, and need unique retrieval? | new category |

---

# 12. Final Note

Categories must remain **small, stable, and semantically meaningful**. If you follow this spec, Contextus will retrieve the right knowledge at the right time — without slowing the model or polluting the context pack.
