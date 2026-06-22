Perfect — dual-purpose is the right call. One canonical source avoids drift and makes maintenance easy. The current doc is already strong for both humans and the skill, but we can make it much more user-friendly at the top without losing any depth for prompting.
Recommended Structure for Dual Use
    1    Top: User-first section (TL;DR, Quick Start, Why This Matters) — approachable for new users reading it in the docs or .claude/context/.
    2    Core Content — unchanged depth (the philosophy, rules, examples, tables) for both humans learning the system and the skill consuming it as context.
    3    Bottom: Skill-Specific Guidance — clearly marked (e.g., in a collapsible-style section or “For Contextus Skills / Create Flow” heading) so humans can skip it, but the LLM sees it when front-loaded.
This way the file stays self-contained.
Revised Version Outline + Key Changes
Here’s a polished, ready-to-use version with improvements:
# Contextus Category & Tag Specification

### How to choose the correct context category, avoid overlap, decide when to create a new one, and how tags complement categories

This document defines the rules for `.claude/context/` files. It serves as both **user documentation** and **guidance for Contextus skills** (especially the create/propose context flow).

**Goal**: Keep the knowledge base semantically clean, retrieval-friendly, and high-signal so proactive injection works well without bloat.

---

## Quick Start for Users

**Core Principle**  
A category must describe the **semantic role** of the content — specifically:  
**"What question should this answer when retrieved?"**

- One category per file (based on retrieval intent).
- Multiple tags per file (for topics).
- Create new categories **rarely** — only when something recurs with truly distinct retrieval needs.

**Common Categories**:
- `arch-` → "What is the structure?"
- `decision-` → "What did we choose?"
- `tradeoff-` → "Why did we choose it?"
- `gotcha-` → "What went wrong?"
- `project-` → "What are the project's ground rules?"
- `api-` → API contracts
- `question-` → Important open questions (keep rare)

See the full framework and examples below for details.

---

## 1. Core Principle
*(original content remains here)*

---

## 2. Categories vs Tags
*(original 2.1–2.4 unchanged)*

---

## 3. The Category Decision Framework
*(original rules 1–4 unchanged — this is the heart of the doc)*

---

## 4. The One-Sentence Test
*(unchanged)*

---

## 5–11. (All remaining original sections unchanged: Architecture splitting, arch vs decision, decision vs project, tags, edge cases, summary table, etc.)

---

## For Contextus Skills & Create/Propose Flow

When generating or proposing context files (as a skill or proactive capture):

**Output Requirements**
- Always produce complete, ready-to-save Markdown file(s) with valid frontmatter.
- Filename: `category-topic.md` (lowercase kebab-case).
- Use this exact frontmatter structure:
  ```markdown
  ---
  name: gotcha-lancedb
  description: Brief one-line summary (actionable)
  metadata:
    type: gotcha
    tags: [lancedb, schema, embedding]
  ---
    •    If content has multiple semantic roles (e.g., reasoning + structure + outcome), split into separate files and clearly label them (e.g., --- FILE: tradeoff-xxx.md ---).
    •    Show step-by-step reasoning using the Category Decision Framework.
    •    Suggest 3–6 high-value, reusable tags.
    •    Prefer existing categories unless Rule 3 is clearly met.
This ensures consistent, high-quality captures that improve retrieval and proactive suggestions.

Final Note
(original #12 unchanged)
Categories must remain small, stable, and semantically meaningful…
### Why This Works for Both Audiences
- **Users** get an immediate, scannable entry point (Quick Start + common categories) so they don't drown in the full spec when first reading it.
- **The Skill** still gets the entire detailed philosophy + explicit output requirements when front-loaded.
- No duplication — single source of truth.
- The added sections are short and reinforce the philosophy without adding much token overhead.

This pattern (user-friendly header + deep spec + tool-specific instructions) is common in well-maintained developer tools and knowledge bases.

Would you like me to:
- Output the **full revised Markdown** with all sections integrated?
- Adjust the tone/length of the Quick Start?
- Add examples or cross-links?

Just let me know how you'd like to tweak it. This doc is already a standout part of Contextus — these changes will make it even more effective as both user doc and skill context.
