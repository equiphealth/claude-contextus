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

**Status (2026-06-15): the mechanics below are DONE; what remains is a real
marketplace-install smoke test (unverifiable locally).**

- [x] Add the `SessionStart` dep-install step (`package.json` diff → install into
      `${CLAUDE_PLUGIN_DATA}`). Must run BEFORE `ensureDaemonRunning`. — DONE:
      `ensureDepsInstalled()` (detached `npm install --omit=dev`, idempotent via
      package.json diff), called first in `session-start-hook.js`. Strict no-op in
      dev / `--plugin-dir`.
- [x] **Drop the `tsx` runtime requirement** — DONE via option (a): `tsconfig`
      includes `daemon/**`, `dist/` is committed (runtime `.js` only), and the daemon
      runs as `node dist/daemon/server.js`. tsx-on-`.ts` is now a dev-only fallback.
- [x] `daemon-control.js`: spawn with `NODE_PATH` / resolved `dist` paths instead of
      `REPO_ROOT/node_modules/.bin/tsx`. — DONE: `resolveLaunch()` prefers compiled
      JS; `depsNodeModules()` sets `NODE_PATH` to `${CLAUDE_PLUGIN_DATA}/node_modules`
      when packaged, repo `node_modules` in dev.
      - ⚠️ **Bug found + fixed in the process:** `findPluginJson()` resolved
        `..`-from-`lib/`, which returned null when run as `dist/lib/config.js` (→ `..`
        is `dist/`), silently falling back to DEFAULTS (`provider: transformers`,
        HF-blocked) instead of the configured `ollama`. Now honors
        `$CLAUDE_PLUGIN_ROOT` then walks up. This would have shipped a broken default
        for every install.
- [x] First-run install latency: surface it via systemMessage. — DONE (the
      "installing dependencies, first launch only…" line).
- [ ] Toolchain caveat in README: target needs Node 22 + a build toolchain for the
      native `@lancedb` bindings; on HF-blocked networks the transformers path still
      needs the model-fetch workaround (see embedding-download-risk). — STILL TODO.
- [x] A `marketplace.json`. — DONE: `.claude-plugin/marketplace.json` (`name:
      "claude-contextus"`, plugin `name: "contextus"`, `source: "."`). The two
      plugin.json files are now intentional + documented (root = runtime config,
      `.claude-plugin/` = manifest; names aligned to `contextus`).

**Acceptance spec (from `docs/quick-start.md`, document-driven) — NOT yet smoke-tested
on a real install:** these exact commands must work for an end user:
```text
/plugin marketplace add anthonypdawson/claude-contextus
/plugin install contextus@claude-contextus
```
After install, hooks must fire automatically (no enable step), the daemon must spawn
via the SessionStart dep-install path (NOT repo-local tsx), and `/contextus-setup`
must work first-try. quick-start.md's **[v1.1]** lines are the pass/fail checklist.

**Guardrails added this round:** `npm run verify:dist` + a CI "Verify committed dist/
is fresh" gate (a rebuild must produce no diff), and CI Node bumped 20 → 22 to match
`engines >=22` + `engine-strict`.

**The one thing left:** push to GitHub and run the acceptance commands against the
real marketplace. The packaged dep-install + NODE_PATH path is unverifiable from a
`--plugin-dir` dogfood session (node_modules present → the bootstrap no-ops by
design), so it needs a genuine clean-machine install to confirm.

### Smoke-test recipe (testing the install without trashing the dogfood loop)

**What's "fresh" and what isn't.** A marketplace install git-clones the repo to
Claude's plugin cache — so the *code* is fresh (no `node_modules`, committed `dist/`)
and the dep-bootstrap path genuinely fires. But **state is NOT fresh**: `~/.contextus/`
(corpora, daemon, port 37800) is hardcoded and SHARED by both install methods. So:

- **The daemon is persistent + detached — it does NOT die when your last Claude session
  closes** (no SessionEnd hook, no idle-exit; only SIGTERM/SIGINT or reboot stops it).
  So if your `--plugin-dir` daemon is up, the marketplace session's `ensureDaemonRunning`
  finds it healthy and **never spawns its own** → you'd "test" nothing. **Kill it first.**
- Corpora already exist, so you won't exercise first-embed.
- The native `@lancedb` build will likely succeed from your Mac's prebuilt-binary cache —
  proving the WIRING, not that a toolchain-less / different-arch machine can build. That
  still needs a VM/container.

**Only ONE install method active at a time.** `--plugin-dir` ADDS a plugin on top of
installed ones, so running both = double hooks → two injections + two footers. The data
is never at risk (corpora are method-agnostic, same format); the mess is purely
double-loading.

```text
# TEST the marketplace install:
1. Turn OFF the --plugin-dir wrapper (so plugin-dir is not in play)
2. kill $(cat ~/.contextus/runtime/daemon.pid)        # force a real spawn
3. /plugin marketplace add anthonypdawson/claude-contextus
   /plugin install contextus@claude-contextus
4. New session (NO --plugin-dir). Verify:
   - deps land in $CLAUDE_PLUGIN_DATA/node_modules
   - daemon runs node dist/daemon/server.js  (lsof -ti :37800 | xargs ps)
   - /health → provider=ollama, modelLoaded=true
   - /contextus-setup works first-try

# RESTORE the dogfood loop:
5. /plugin uninstall contextus  (+ remove the marketplace)
6. Re-enable the --plugin-dir wrapper
   (leftover $CLAUDE_PLUGIN_DATA/node_modules is harmless dead weight)
```

> **Want true isolation instead?** A `CONTEXTUS_HOME` (+ `CONTEXTUS_PORT`) env override
> instead of the hardcoded `~/.contextus` / 37800 would let a test session use a
> throwaway state dir + separate port, never touching the live daemon. Small change,
> filed as a future option.

## Decision

**Defer to v1.1 (a Distribution milestone, separate from the v2 feature roadmap).**
`--plugin-dir` is the right call for the dogfood phase. Revisit packaging once contextus
has proven itself on the automation project — the migration may surface more env
assumptions worth folding in here.

**Docs:** code.claude.com/docs/en/plugins-reference.md — "Plugin caching and file
resolution", "Persistent data directory", "Environment variables".
