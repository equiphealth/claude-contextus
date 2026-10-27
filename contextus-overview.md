# Contextus — overview

*Based on the Contextus repository as reviewed Oct 25, 2026, version 0.20.0, Node 22+, TypeScript. This is an overview of what the system does, not a submission artifact and not a porting guide.*

## The problem it solves

Claude Code forgets architecture decisions, coding patterns, and project conventions between sessions. A developer re-explains the same context, or worse, gets advice that contradicts a decision made last week.

Contextus turns ephemeral Claude sessions into inspectable context for the project, so less time is spent re-teaching the agent and rediscovering decisions.

Its own one-liner: it turns ephemeral Claude sessions into inspectable context for the project, so you spend less time re-teaching the agent and less time rediscovering decisions.

## The core idea

- Knowledge is stored as plain markdown files in the repo, git-trackable, human-readable, merge-friendly. LanceDB is the retrieval index over those files, not the source of truth.
- The corpus includes not just code and docs, but how the app actually works in practice, including business logic worked through in sessions.
- Capture happens as you work, not as a separate documentation phase. When you debug an issue, make an architectural choice, or discover a gotcha, Contextus offers to capture it.
- Retrieval is proactive, not reactive. Relevant context is injected automatically on a prompt, with no manual "remember to look this up" step.

## How it works, end to end

1. You work with Claude Code as normal.
2. Contextus captures patterns you discover: decisions, gotchas, conventions, tradeoffs, APIs, performance notes.
   - Default capture mode is `staging`: files are written and reviewed at normal `git add` / commit time.
   - `propose` mode proposes first, via a one-line footer.
   - `silent` mode captures without a footer.
3. On a future prompt, the relevant patterns are retrieved and injected automatically.
4. The system tracks which injected patterns actually help, so it can learn what is useful versus merely retrieved.

## Capture

- Post-tool-use hooks watch file writes and edits, and a stop hook runs a capture gate and a stop evaluation.
- Transcript mining can extract patterns from past Claude Code sessions, so a corpus can be built from work already done, not only from new work.
- A setup wizard skill walks a new project through installation, configuration, and first corpus creation.
- An upgrade and migration system handles version changes, with a migrations registry, so an existing corpus survives upgrades.
- Captures are data, never instructions: injected context is marked as data, not as a command to the model.

## Retrieval

The retrieval pipeline is the strongest part of the system. In outline:

- **Prompt in:** a UserPromptSubmit hook sends the prompt and working directory to a local daemon. The daemon never blocks the session; on failure it fails open and the session continues.
- **Embedding:** nomic-embed-text, 768 dimensions, via Ollama by default, Transformers.js in-process as an alternative, with a keyword-only mode that works with zero setup.
- **Search:** LanceDB vector search, scoped to the project, workspace siblings, and user context, fetching more candidates than will be injected.
- **Hybrid search, adaptive:** if the best semantic score is below the injection floor, a BM25-like keyword scan is fused in with Reciprocal Rank Fusion. This rescues exact-symbol queries, like a function name, that pure embeddings miss.
- **Query expansion, adaptive:** if the initial best score is still low, up to 3 alternate phrasings are generated, via Ollama qwen2.5:3b with a Bedrock Haiku fallback, and searched as well.
- **Reranking:** candidates are scored by similarity, source weight, context-type boost, freshness decay with a 180-day half-life, and a hit-count boost for patterns that have actually helped before.
- **Collapse, dedupe, floor:** one chunk per file before the top-K cut, near-duplicates dropped at cosine 0.95 or above, and a final gate on raw similarity, not on the reranked score.
- **Format:** injected context is headed, token-budgeted at 3000 tokens by default, with the first chunk always included, and a footer listing the injected filenames and scores.

Default runtime configuration in the reviewed version: topK 5, injection floor 0.725, maxTokens 3000, hybrid adaptive, expansion adaptive with a 0.775 threshold.

Outcomes, by design:

- **Inject:** relevant context goes into the session.
- **Near-miss:** no injection, but the best score is close enough that a retrieval-gap notice is shown, with best score, floor, and gap, so drift is visible rather than silent.
- **Plain miss:** silent, logged as a success, so a session is not interrupted for a prompt that simply has no relevant context.

Statusline capacity rules trim injection as the context window fills: over 70% the top-K is cut, over 80% it drops to 1 with a raised floor, over 85% injection is disabled with a warning.

## The daemon

A local-first Node.js / TypeScript daemon, HTTP API, fail-open by design:

- `/health`, `/query`, `/search`, `/capture`, `/notify`, `/reconcile`, `/novelty`, `/introspect`, plus delete and related endpoints.
- Configuration is JSONC, hot-reloaded, with project, user, and workspace scopes.
- Sources are configurable: project context (`.claude/context` in the reviewed version), project docs (`docs`), user context (`~/.contextus/context`), user docs, and workspace siblings.
- An introspect endpoint exposes configuration and corpus statistics, so the system is inspectable rather than a black box.
- Token cost reporting pairs injection overhead with usage rate, via `/context-status --cost`.
- A live activity stream, `/contextus-watch`, shows retrievals in real time.
- A calibration skill replays real transcript prompts to recommend an injection floor, and after 1 to 2 weeks of usage a grading campaign over real injections can refine thresholds.

The daemon problem never blocks a session start, and a hook failure never blocks a prompt.

## Skills

24 skills in the reviewed version, covering the full workflow:

- Setup, upgrade, and daemon management: `contextus-setup`, `contextus-upgrade`, `manage-daemon`
- Capture and creation: `create-context`, `create-doc`, `update-context`, `mine-transcripts`
- Search and status: `context-search`, `context-status`, `context-stats`, `ctx` dispatcher
- Maintenance: `context-audit`, `context-archive`, `context-merge`, `context-tag`, `context-review`, `rebuild-embeddings`, `context-calibrate`, `context-doctor`, `contextus-watch`
- Configuration and linking: `configure`, `link-project`, `add-patterns`, `migrate-memory`

Skills are Claude-style skill files, invoked by slash command, with frontmatter and instructions. That slash-command surface is also where a known Claude Code issue lives: a `<local-command-caveat>` wrapper can contradict a skill's "execute immediately" instructions, especially on smaller models.

## What it is not

- Not a hosted memory service. No vendor server in the path, no signup, no token creation to use it. The corpus is files in a repo you control.
- Not a rewrite of your notes. The system proposes and captures, it does not silently rewrite the corpus in place. Relationship detection, supersedes / contradicts / duplicates, is a proposal for human review, not an automatic edit.
- Not a replacement for documentation. It captures the decisions and gotchas that documentation usually misses, and it can surface docs as a source, but it does not write your docs for you.
- Not a second model. It is a retrieval and capture layer around the model you are already using, with a small local model only for query expansion.

## Requirements

- Claude Code, CLI, desktop, or IDE extension.
- Node 22 or newer.
- A C/C++ build toolchain for the native LanceDB bindings, Xcode Command Line Tools on macOS, build-essential on Linux.
- Optional, for better recall: Ollama with nomic-embed-text, or Transformers.js. Without either, keyword search still works.

## Capabilities, in one list

- Automatic, proactive context injection on every prompt, with fail-open behaviour.
- Markdown corpus, git-trackable, with staging / propose / silent capture modes.
- Transcript mining to build a corpus from past sessions.
- Hybrid semantic plus keyword search, with adaptive query expansion and a keyword fallback when embeddings are unavailable.
- Multi-source search: project context, project docs, user context, user docs, workspace siblings.
- Reranking by source, type, freshness, and proven usefulness.
- Near-miss visibility, so retrieval gaps are noticed, not hidden.
- Calibration from real prompts and real usage, not from guessed thresholds.
- Observability: cost reporting, status, stats, live watch, introspect endpoint.
- Setup wizard, upgrade migrations, and 24 skills for the full lifecycle.
- Local-first, no hosted store, no signup, corpus editable in any text editor.
