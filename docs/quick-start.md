# Contextus Quick Start

Get from zero to your first auto-injected context in about five minutes.

> **Document-driven note (remove at v1.1 GA):** this guide is written for the
> **finished GitHub-install experience** and serves as the *acceptance spec* for the
> v1.1 packaging work (see [dev/PACKAGING.md](dev/PACKAGING.md)). Lines marked **[v1.1]** are
> not true yet — until then, use the **[v1 today]** fallback right beside them. When
> v1.1 ships and the marketplace install works, delete the fallbacks and this note.

---

## What contextus does

You write project patterns once into `.claude/context/`. From then on, contextus
**retrieves the relevant ones automatically and injects them into Claude's context on
every prompt** — semantic search, no `/search` required. Injected blocks are tagged
`[contextus — relevant project context]`, and when Claude uses one you'll see a footer
like `Context: used: decision-use-logger-helper.md (0.62)`.

It's the inverse of a memory system you query: **the context finds you.**

---

## Prerequisites

- **Claude Code** (CLI, desktop, or IDE extension)
- **Node 22+** (the daemon runs on it)
- **An embedding provider**, one of:
  - **Ollama** (recommended, local, private): `ollama pull nomic-embed-text`
  - **Transformers.js** (in-process, needs a one-time model download — blocked on some
    corporate networks; see [embedding notes](#embedding-provider))

---

## 1. Install

**[v1.1]** Add the marketplace, then install the plugin:

```text
/plugin marketplace add equiphealth/claude-contextus
/plugin install contextus@claude-contextus
```

That's it — hooks activate automatically, the daemon starts on your next session, and
skills appear under the `/context-*` and `/contextus-*` namespace.

**[v1 today]** Until the marketplace ships, clone + load by directory:

```bash
git clone https://github.com/equiphealth/claude-contextus ~/src/claude-contextus
cd ~/src/claude-contextus && pnpm install      # builds the daemon's native deps
# then, in any project you want contextus active:
claude --plugin-dir ~/src/claude-contextus
```

> **Tip (v1 today):** a directory-aware shell wrapper auto-adds `--plugin-dir` only in
> projects that have contextus set up, so you don't type it every time. See
> [usage.md](usage.md#shell-wrapper-v1-today).

---

## 2. Set up a project

In a session inside your project:

```text
/contextus-setup
```

This scaffolds `.claude/context/`, adds a small marked stanza to your `CLAUDE.md`, and
builds the initial embedding corpus. Already have a `.claude/memory/` from an older
system? Run `/migrate-memory` instead — it converts your memories into context files
(see [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)).

**What you should see:** a session-start message like
`contextus: corpus built — N patterns embedded.`

---

## 3. See it work

Add one pattern (or let `/migrate-memory` bring yours), then ask a natural question
about it:

```text
How should I handle logging in this project?
```

**What just happened:**
1. Your prompt was embedded and matched against the corpus.
2. The top matches above the injection floor were prepended to Claude's context,
   tagged `[contextus — relevant project context]`.
3. Claude's thinking references them by name; the reply ends with
   `Context: used: <file> (<score>)`.

> **Ask naturally, not in keywords.** A full question ("how should I handle logging?")
> retrieves *better* than a terse one ("logging") — short prompts dilute the semantic
> signal. (Very short exact-symbol queries like `getLogger` are a known weak spot until
> hybrid search lands.)

---

## 4. Know it's working

- **In the response:** the `Context: used:` footer names the file + similarity score.
- **In the thinking:** Claude says something like *"From the contextus context, there's
  a pattern about…"*
- **Health check:** `/context-status` — daemon up, corpus size, current floor.
- **What would a prompt retrieve?** `/context-search "your question"` prints the top
  matches with scores and whether each clears the floor.

**Nothing injected?** Usually one of:
- *Daemon not running* → `/context-status` shows it; it self-recovers next session.
- *Score below the floor* → `/context-search` shows the top score; if a clearly-relevant
  pattern sits just under, your floor is too high for this corpus → calibrate (step 5).
- *Empty/cold corpus* → re-run `/contextus-setup` or `/rebuild-embeddings`.

---

## 5. Tune it to your corpus (after ~a week of use)

The default injection floor is generic. Calibrate it to *your* project's similarity
distribution:

```text
/context-calibrate --floor          # replay your real prompts → recommend a floor
/context-calibrate --floor --apply   # write it (THIS PROJECT ONLY)
```

**Per-project by design:** the applied floor is written to *this project's* config
(`~/.contextus/data/<project>/config.json`), so tuning one project never changes
another. A team can commit a shared floor to `<project>/.claude/contextus.json` (it
overrides the machine-local value). See [calibration.md](calibration.md) for the full
tuning lifecycle and the config precedence.

---

## Next steps

- **[usage.md](usage.md)** — day-to-day: creating context, reading injections, sources.
- **[calibration.md](calibration.md)** — floor + usage-eval tuning, config tiers.
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — moving from an older memory system.

## Embedding provider

Set in config (`config.embedding.provider`): `ollama` (local, private, recommended) or
`transformers` (in-process). On networks that block Hugging Face downloads, prefer
Ollama, or fetch the model on an unblocked machine first (see the embedding-download
notes in the design docs).
