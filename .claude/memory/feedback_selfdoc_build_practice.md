---
name: selfdoc-build-practice
description: How Claude should self-document during the build — verify before embedding, one ledger
metadata:
  type: feedback
---

**Guidance**: When authoring `.claude/context/` files during the contextus build, treat them as corpus, not diary.

**Why**: Anything written into `.claude/context/` gets embedded and *proactively injected* into future sessions as an authoritative pattern. A `gotcha-` written mid-pain, before the fix is confirmed, is confident fiction the system will resurface. A wrong context file is worse than no file — no-injection is a designed outcome (the floor); a plausible-but-wrong injected pattern is the expensive failure mode. Claude narrates *intended* decisions, which aren't always what the code does.

**How to apply**:
- **Verify before embedding** — a file's claims are checked against code/passing test, not written from memory. "I think I used `.add()`" is a scratch note; "`Table.add()`, confirmed by phase-0 round-trip" is corpus-worthy.
- **One ledger, not four** — Layer 3 (`.claude/context/`) = curated patterns; commits = rationale; claude-mem = raw narration (already running); `/introspect` = state. Don't keep a parallel Layer-2 log; it's an ephemeral scratch buffer flushed into Layer 3 at the phase boundary.
- **Self-validation is a smoke test, not quality measurement** — Claude writes the corpus AND judges retrieval on it (blind spot). "It injected my gotchas" ≠ "retrieval is calibrated." Build corpus skews to gotcha-/decision-; normative patterns under-represented.
- **Flush at phase boundaries, not mid-loop.**

Full reasoning: `docs/SELF_DOCUMENTATION.md` §4.5.

**Related**: [[build-execution-cadence]], [[design-scoping-v1-v2]]
