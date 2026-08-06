---
name: expansion-hallucination-inflates-injection-score
description: Adaptive query expansion (qwen2.5:3b) can hallucinate a phrasing that literally string-matches an unrelated stored pattern, inflating the reported best-score well above what the raw prompt alone would ever hit. Empirically tested phi4-mini and Haiku as alternatives -- neither swap-the-model option is a clean win.
metadata:
  type: gotcha
  tags: ["expansion", "retrieval", "ollama", "qwen2.5", "injection-floor", "calibration", "phi4-mini", "haiku"]
---

# Symptom

A prompt injects context that is topically unrelated to the pattern it matched, at a similarity score high enough to look like a real semantic hit (e.g. 0.71-0.76, well above the 0.70-0.725 injection floor).

Example: the prompt "What was the score on codebase-memory-mcp?" (a meta-question about a prior injection event) matched `gotchas/gotcha-codebase-memory-mcp-initial-connect-race.md` at 0.76 -- a file about an MCP server reconnect race that has nothing to do with scoring or injection floors.

# Root Cause

The daemon's `best` score used for the floor comparison is `max(originalPromptScore, expansionVariantScores...)`, not just the raw prompt's score. When initial retrieval scores poorly, adaptive expansion asks a small local model (qwen2.5:3b via Ollama) to generate 3 alternate phrasings of the prompt. Because it's a lightweight 3B model, it can hallucinate an interpretation of an ambiguous token instead of expanding the query faithfully.

Concretely, from the daemon log (`~/.contextus/logs/daemon.log`):

```
Expansion fired (variants=[1] what happened in codebase-memory-mcp match | [2] details of codebase-memory-mcp game | [3] scoreboard for codebase-memory-mcp game, provider=ollama/qwen2.5:3b)
Retrieved 1 patterns (scores=0.76, ...)
```

qwen2.5:3b interpreted "codebase-memory-mcp" (an MCP server name) as referring to a *game* ("match", "scoreboard"), and produced variants built around that wrong frame. One of those hallucinated variants then scored high against the stored gotcha purely because both share the literal token `codebase-memory-mcp` -- a lexical/embedding collision, not a real topical match.

A second example from the same session: the prompt "Claude Code loads ALL skill SKILL.md files into the system prompt on every session... How did we handle that" produced an expansion variant "handle resource consumption in Claude sessions" that matched the same unrelated gotcha at 0.71 (just above the 0.70 floor at the time) -- again riding shared vocabulary ("handle", "session") rather than genuine relevance.

# Why qwen2.5:3b specifically

The expansion provider chain is ollama (qwen2.5:3b, fast) -> bedrock (Haiku, fallback on slow/failed calls). qwen2.5:3b is small enough that on ambiguous or jargon-heavy tokens (project-specific identifiers, MCP server names, abbreviations) it can substitute a plausible-sounding but wrong interpretation rather than a faithful rephrasing. Larger models (even Haiku) are less prone to this because they have more world knowledge to disambiguate domain-specific strings.

# Empirical Test: Does Swapping the Model Fix This? (2026-08-03)

Built `scripts/eval-expansion-candidate.ts` -- an ad-hoc harness that reuses the REAL `buildPrompt()`/`parseVariants()`/`expandQuery()` from `lib/retrieval/expand.ts` (not a hand-approximated copy) so test output is byte-identical to what the daemon actually sends/parses in production. Ran 3 prompts through qwen2.5:3b (baseline), phi4-mini (candidate, dense 3.8B, same size class), and Haiku via the real bedrock fallback path, multiple trials each.

**Prompts tested:**
1. "What was the score on codebase-memory-mcp?" (the original documented failure)
2. "Claude Code loads ALL skill SKILL.md files into the system prompt on every session. How did we handle that" (the second documented failure)
3. "what does cap mean in the injection response" (fresh prompt, unrelated to either documented case)

**Results:**

| Model | Prompt 1 | Prompt 2 | Prompt 3 | Latency (warm) |
|---|---|---|---|---|
| qwen2.5:3b (baseline) | 6/9 trials hallucinate "game/match/contest/standings" | 0/2 hallucinate | 0/2 hallucinate | ~400ms |
| phi4-mini (candidate) | 0/6 hit the SAME hallucination, but 5/9 substitute a DIFFERENT one ("memory"->RAM/resource-usage) | invented a FICTIONAL entity ("CLUE"/"CLUED") not present anywhere in the prompt, plus one garbled/truncated output | mostly on-topic but noticeably lower-quality/awkward phrasing | ~400-950ms (but ~10s on FIRST call after a fresh `ollama pull` -- cold-load artifact, not steady-state) |
| Haiku (bedrock fallback, real code path) | 3/3 clean, word-for-word identical every trial | 2/2 clean | 2/2 clean | ~1.5-2.6s |

**Conclusion: swapping the primary model does NOT fix this.** qwen2.5:3b's failure is narrower than it first looked -- it reliably fails on ONE specific compound term (`codebase-memory-mcp` -> game/competition framing) but was clean on the other two prompts tested. phi4-mini is not a improvement: it has the WORST track record of the three across the full test set, including inventing a fictional entity ("CLUE") on prompt 2 -- arguably worse than misinterpreting a real term, since it's fabricating something that doesn't exist at all. Haiku is the only one that was reliably faithful across every prompt and trial (10/10), consistent with the existing theory ("larger models have more world knowledge to disambiguate domain-specific strings") -- but at a real, measured cost: 4-6x the latency of the small local models, PLUS real Bedrock token cost per call (vs free local Ollama). Forcing Haiku for every expansion call would slow down and add cost to the common case (most prompts likely aren't jargon-heavy) to fix a narrow one.

# Workaround / Considerations

- Not yet fixed. Options to consider, updated with empirical findings:
  1. ~~Route ALL expansion through a slightly larger/smarter model (force Haiku)~~ -- empirically confirmed to fix the symptom (10/10 clean) but at a real latency (4-6x) AND token-cost tax (Bedrock $ per call vs free Ollama) applied to every single expansion call, most of which don't need it. Not recommended as a blanket default given the cost profile.
  2. **Selective escalation on suspicion** (most promising, not yet built): detect when qwen2.5:3b's expansion likely went sideways -- e.g. a variant's embedding is suspiciously distant from the original prompt's embedding, a cheap signal that's likely already computed during the search step -- and ONLY THEN re-run that one call through Haiku. Pays the latency/cost tax on the minority of genuinely-ambiguous cases instead of every query.
  3. Guard against literal-token collisions: down-weight or flag matches where the *only* reason for a high score is a shared rare/proper-noun token between an expansion variant and the stored pattern, rather than the original prompt. Complementary to (2) -- this catches the collision even if a bad variant slips through.
  4. Cap how much an expansion variant's score can lift the injected `best` over the raw prompt's own score, so expansion helps recall without letting a single bad hallucinated variant fully drive an injection decision.
  5. Log/surface which variant produced the winning score (already available in daemon.log) in the injected footer itself, so mismatches are easier to spot live instead of requiring a log dive.
  6. ~~Swap the primary local model to a different small model (e.g. phi4-mini)~~ -- empirically tested, NOT an improvement. Different failure mode at a similar or worse rate, including a case of inventing a fictional entity. Ruled out.
- This was discovered via manual statusline/threshold testing (lowering `injectionFloor` from 0.725 to 0.70 in `.claude/contextus.jsonc`) -- repeated near-miss/borderline injections made the pattern visible across several prompts in one session.
- Empirical model comparison via `scripts/eval-expansion-candidate.ts` -- rerunnable for future candidate models: `npx tsx scripts/eval-expansion-candidate.ts --model <ollama-model> --prompt "..." [--haiku]`.

# Related

- `scripts/eval-expansion-candidate.ts` -- the reusable comparison harness built for this investigation
- `implementation/implementation-query-expansion.md` -- how the expansion pipeline works
- `implementation/implementation-expansion-providers.md` -- the ollama/bedrock provider chain and cold-start gotcha
