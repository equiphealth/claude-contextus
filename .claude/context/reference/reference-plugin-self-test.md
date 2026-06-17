---
name: plugin-self-test
description: How to test plugin loading and skill registration using claude --plugin-dir
metadata:
  type: reference
  tags: [testing, plugin, skills, development]
---

# Plugin Self-Test Procedure

How to verify the contextus plugin loads correctly and skills register.

## Quick Smoke Test

```bash
claude --plugin-dir ~/src/claude-contextus --print "list your available skills that start with context or ctx"
```

**What to check**: The response should list `/context-status`, `/context-calibrate`, `/context-doctor`, `/context-search`, `/create-context`, `/configure`, `/contextus-setup`, `/contextus-watch`, `/rebuild-embeddings`, `/audit-context`, `/audit-stale`, `/migrate-memory`, `/create-doc`, `/add-patterns`, `/tag-context`, and the `ctx-*` aliases.

If skills are missing or the plugin doesn't load, the response will just say it doesn't know those commands.

## Targeted Skill Test

```bash
claude --plugin-dir ~/src/claude-contextus --print "show me the instructions for /context-status"
```

The response should include the full SKILL.md content for that skill. If it returns nothing or "I don't have that skill", the skill isn't registering.

## Load Time Test

```bash
time claude --plugin-dir ~/src/claude-contextus --print "hi" 2>/dev/null
```

Compare against baseline (no plugin):
```bash
time claude --print "hi" 2>/dev/null
```

Expected: negligible difference (plugin is just static files, no runtime overhead at load).

## Debugging Failures

**No skills appear at all:**
- Check `--plugin-dir` points at repo root (parent of `.claude-plugin/`), NOT at `.claude-plugin/` itself
- Verify `.claude-plugin/plugin.json` exists and is valid JSON
- Check for empty skill directories (dirs under `skills/` with no SKILL.md cause silent failures)

**Some skills missing:**
- Each skill dir MUST have a `SKILL.md` with valid frontmatter including `name:` field
- The `name:` field is what registers the skill, NOT the directory name
- Symlinks don't work for aliases — use real directories with their own SKILL.md

**Plugin loads but hooks don't fire:**
- Hooks are in `.claude-plugin/hooks/` — check they exist and are valid JS
- `--plugin-dir` in `--print` mode may not trigger all hook types (UserPromptSubmit fires, Stop does not)

## Injection Test Cases

Test that contextus retrieves and injects relevant patterns. Each case includes concrete examples for the contextus corpus plus general characteristics for adapting to your own corpus.

### Test Case 1: Single-Topic High-Relevance
**Characteristics**: Narrow query, directly matches corpus content  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "How does the contextus daemon work?"
```
**Expected**: `decision-daemon-from-dist.md`, possibly `question-daemon-lifecycle.md` (similarity > 0.75)  
**Pass criteria**: Top match is semantically on-topic, similarity score well above floor

### Test Case 2: Multi-Topic Query
**Characteristics**: Prompt contains 2-3 distinct topics in corpus  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "How do I configure the daemon and calibrate the injection floor?"
```
**Expected**: Daemon config patterns + calibration decisions, possibly lower individual scores  
**Pass criteria**: Multiple relevant patterns injected, covers both topics  
**Note**: Tests query dilution behavior (v2 transform feature addresses this)

### Test Case 3: Synonym/Paraphrase Match
**Characteristics**: Query uses different words than corpus patterns  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "What vector model does this use for semantic search?"
```
**Expected**: Same patterns as "what embedding model" query (nomic-embed DESIGN.md chunks)  
**Pass criteria**: Retrieves despite lexical mismatch (semantic > keyword)

### Test Case 4: Below-Floor Off-Topic
**Characteristics**: Completely unrelated to project domain  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "What's the weather forecast for tomorrow?"
```
**Expected**: NONE  
**Pass criteria**: Log shows `reason: "below_floor"`, best_score < injectionFloor (0.45 default)

### Test Case 5: Marginal Relevance
**Characteristics**: Tangentially related, tests floor boundary  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "How do I debug Node.js memory leaks?"
```
**Expected**: Maybe 1 weak match (daemon = Node), or none  
**Pass criteria**: Either injects 1 low-score pattern (0.45-0.65) or skips entirely  
**Use**: Helps tune floor threshold — if this injects, floor may be too low

### Test Case 6: Broad Overview Question
**Characteristics**: High-level "what/why" questions  
**Contextus example**:
```bash
claude --plugin-dir ~/src/claude-contextus --print "What is contextus and why would I use it?"
```
**Expected**: Doc overview chunks, `decision-design-scoping-v1-v2.md`  
**Pass criteria**: Gets architectural context, not implementation details

## Verifying Injection via Logs

After running test prompts, check the daemon logs to verify retrieval behavior:

```bash
# View recent queries
tail -50 ~/.contextus/runtime/daemon.log | grep -A 5 "Query received"

# Check injection decisions
tail -100 ~/.contextus/runtime/daemon.log | grep "injected\|below_floor"

# See similarity scores
tail -100 ~/.contextus/runtime/daemon.log | jq 'select(.event == "retrieval") | {prompt: .prompt_preview, top_match: .matches[0].metadata.name, score: .matches[0].similarity}'
```

**What to verify:**
- Test 1-3: `injected: true`, similarity > floor (0.45 default)
- Test 4: `injected: false`, `reason: "below_floor"`, best_score < 0.45
- All tests: top match makes semantic sense for the query

**Common issues:**
- All prompts inject → floor too low (should skip off-topic queries)
- No prompts inject → floor too high, or corpus not embedded
- Wrong patterns inject → dedup threshold too high (corpus fragmented) or need more context files

## Key Facts

- `--plugin-dir .` from the repo root is correct
- No `skills` array needed in plugin.json — Claude Code auto-discovers from `skills/` directory
- The `--print` flag sends one prompt and exits (no interactive session) — ideal for scripted checks
- Skills are registered by their `name:` frontmatter field, invoked as `/<name>`
- **Dev mode auto-detected**: when `tsconfig.json` exists at repo root, daemon spawns via `tsx` (live source). No `tsc` build needed for .ts changes to take effect
- Override with `CONTEXTUS_DEV=0` to force production (compiled dist/) mode
- Injection happens on UserPromptSubmit hook — verify with daemon logs, not Claude's response
- Below-floor prompts should appear in logs with `reason: "below_floor"` and `best_score` logged
- Injection happens on UserPromptSubmit hook — verify with daemon logs, not Claude's response
- Below-floor prompts should appear in logs with `reason: "below_floor"` and `best_score` logged
