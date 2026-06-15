# Packaging & Distribution (v1.1)

How contextus gets installed, and what it takes to make it GitHub-marketplace
installable (not just `--plugin-dir`). Researched against current Claude Code plugin
docs 2026-06-15.

---

## v1 reality: `--plugin-dir` is the supported personal pattern

```bash
claude --plugin-dir ~/src/claude-contextus
```

This is **not** a workaround — for a plugin with heavy native deps + a daemon, the
docs treat clone + local install + `--plugin-dir` as the right pattern for personal
use. The repo must be `pnpm install`'d (so `node_modules/.bin/tsx` + native deps
exist). Keep using this for the automation migration; don't block on packaging.

---

## Why GitHub install doesn't "just work" today

Claude Code treats plugins as **pre-built, self-contained assets**:

- It **copies** the plugin to `~/.claude/plugins/cache/{name-version}/` and sets
  `${CLAUDE_PLUGIN_ROOT}` there. That path is **ephemeral** — changes every update,
  old versions deleted after ~7 days. Nothing stateful may live in it.
- It does **NOT** run `npm/pnpm install`, and runs **no** `postinstall`/`prepare`/
  build lifecycle. A clone has source only.

So a marketplace clone of contextus would have: no `node_modules` (gitignored), no
`tsx` (so the `.ts` daemon can't spawn), no `@lancedb`/`@xenova` (native deps), and
no `dist/` (gitignored, no build runs). Every load-bearing piece is missing.

---

## The supported pattern (and why it fits us)

The documented way for a dep-heavy plugin:

1. **`SessionStart` hook installs deps into `${CLAUDE_PLUGIN_DATA}`** — a *persistent*
   dir that survives plugin updates (unlike `${CLAUDE_PLUGIN_ROOT}`). Idiomatic form:
   ```
   diff -q "${CLAUDE_PLUGIN_ROOT}/package.json" "${CLAUDE_PLUGIN_DATA}/package.json" >/dev/null 2>&1 \
     || (cd "${CLAUDE_PLUGIN_DATA}" && cp "${CLAUDE_PLUGIN_ROOT}/package.json" . && npm install) \
     || rm -f "${CLAUDE_PLUGIN_DATA}/package.json"
   ```
2. **Reference deps via `NODE_PATH=${CLAUDE_PLUGIN_DATA}/node_modules`** when spawning
   the daemon / running hooks.
3. **Native bindings build on the TARGET machine** during that install — which
   actually *solves* cross-platform distribution (no committing per-arch binaries),
   at the cost of first-session install latency + a working build toolchain on target.

**Why this fits contextus specifically:**
- We **already have a `SessionStart` hook** — the dep-install step slots in ahead of
  the daemon-warm logic.
- Daemon **state already lives in `~/.contextus/`** (data, logs, runtime PID) — outside
  the plugin root, exactly as the docs require. We got that right already.

## The v1.1 work, concretely

- [ ] Add the `SessionStart` dep-install step (`package.json` diff → install into
      `${CLAUDE_PLUGIN_DATA}`). Must run BEFORE `ensureDaemonRunning`.
- [ ] **Drop the `tsx` runtime requirement** — `${CLAUDE_PLUGIN_ROOT}` is ephemeral
      and shouldn't be compiled into. Either (a) commit a `dist/` build and run the
      daemon as `node dist/daemon/server.js`, or (b) make `tsx` one of the managed
      `${CLAUDE_PLUGIN_DATA}` deps. (a) is cleaner — no tsx at runtime at all.
- [ ] `daemon-control.js`: spawn with `NODE_PATH` / resolved `dist` paths instead of
      `REPO_ROOT/node_modules/.bin/tsx`.
- [ ] First-run install latency: surface it via the existing systemMessage verbosity
      ("installing dependencies, first launch only…").
- [ ] Toolchain caveat in README: target needs Node + a build toolchain for the native
      `@lancedb` bindings; on HF-blocked networks the transformers path still needs the
      model-fetch workaround (see embedding-download-risk).
- [ ] A `marketplace.json` / publish flow. **Acceptance spec (from `docs/quick-start.md`,
      written document-driven):** these exact commands must work for an end user:
      ```text
      /plugin marketplace add anthonypdawson/claude-contextus
      /plugin install contextus@claude-contextus
      ```
      Requires `.claude-plugin/marketplace.json` at the repo root with `name:
      "claude-contextus"` (the marketplace id after `@`) and a plugin entry `name:
      "contextus"` (the now-renamed plugin) pointing at `source: "."`. After install,
      hooks must fire automatically (no enable step), the daemon must spawn via the
      SessionStart dep-install path (NOT repo-local tsx), and `/contextus-setup` must
      work first-try. quick-start.md's **[v1.1]** lines are the pass/fail checklist.

## Decision

**Defer to v1.1 (a Distribution milestone, separate from the v2 feature roadmap).**
`--plugin-dir` is the right call for the dogfood phase. Revisit packaging once contextus
has proven itself on the automation project — the migration may surface more env
assumptions worth folding in here.

**Docs:** code.claude.com/docs/en/plugins-reference.md — "Plugin caching and file
resolution", "Persistent data directory", "Environment variables".
