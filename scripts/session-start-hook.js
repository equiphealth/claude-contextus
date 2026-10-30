#!/usr/bin/env node
/**
 * SessionStart hook — ensure the daemon is up and warm, then make sure the
 * project's corpus actually exists (first-run onboarding).
 *
 * Thin ESM JS (no build step). Spawns the daemon if needed, then polls /health
 * until the model is warm (bounded — never hangs session start). Whatever
 * happens, it emits `{ continue: true }` so a daemon problem never blocks the
 * session; a cold first prompt just degrades to no-injection (DESIGN.md graceful
 * degradation).
 *
 * Auto-reconcile (the silent safety net — first-run-onboarding memory):
 * after the daemon is warm we ask it whether this project's corpus is
 * cold/stale (POST /reconcile check). If so we fire a BACKGROUND reconcile —
 * never blocking, the embed warms while the session runs — and report it via
 * systemMessage. Plus a one-time nudge: if the project CLAUDE.md has no contextus
 * stanza, we suggest /contextus-setup (discoverability). This hook NEVER edits
 * CLAUDE.md — that's solely /contextus-setup's job.
 *
 * Transparency (user preference: surface what the system did). We report daemon
 * state via `systemMessage` — which renders to the USER in the UI, NOT to
 * Claude's context. We deliberately never use `additionalContext` for this:
 * announcing the daemon to Claude every session would pollute the very context
 * window contextus exists to keep clean.
 *
 * Verbosity (config.notifications.verbosity, or CONTEXTUS_VERBOSITY env):
 *   silent  — never emit a message
 *   normal  — only noteworthy events: fresh spawn, still-warming, reconcile, failure
 *   verbose — the above PLUS a heartbeat when an existing warm daemon is found
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
  ensureDaemonRunning,
  ensureDepsInstalled,
  ensureDistBuilt,
  waitForModel,
  getHealth,
  getVerbosity,
  checkCorpus,
  fireReconcile,
  checkTranscriptMining,
  fireTranscriptMining,
  hasContextusStanza,
  hasPopulatedContextDir,
  checkUpgradeNeeded,
  stampVersion,
} from './lib/daemon-control.js';
import { resolveDaemonStatus } from './lib/daemon-status.js';

/** Clean up stale context-stats files (>24h old) from ~/.contextus/runtime/. Best-effort. */
function cleanStaleContextStats() {
  const runtimeDir = path.join(process.env.HOME || '/tmp', '.contextus', 'runtime');
  try {
    const files = fs.readdirSync(runtimeDir);
    const now = Date.now();
    const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
    for (const file of files) {
      if (!file.endsWith('.context-stats.json')) continue;
      const absPath = path.join(runtimeDir, file);
      try {
        const stat = fs.statSync(absPath);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(absPath);
        }
      } catch {
        // Individual file cleanup failure is non-fatal
      }
    }
  } catch {
    // Runtime dir may not exist yet — that's fine
  }
}

/** Read the SessionStart payload from stdin (for cwd). Never hangs on a TTY. */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

/** Compute the projectId hash from an absolute path (matches lib/config.ts projectHash). */
function projectId(cwd) {
  const abs = path.resolve(cwd || process.cwd());
  return crypto.createHash('sha256').update(abs).digest('hex').slice(0, 12);
}

async function main() {
  // Housekeeping: remove stale stats files from previous sessions (best-effort).
  cleanStaleContextStats();

  const verbosity = getVerbosity();

  let cwd = process.cwd();
  try {
    const raw = await readStdin();
    if (raw.trim()) {
      const payload = JSON.parse(raw);
      if (typeof payload.cwd === 'string' && payload.cwd) cwd = payload.cwd;
    }
  } catch {
    /* no payload / not JSON — fall back to process.cwd() */
  }

  // Test mode: skip daemon interaction (for smoke tests in CI without Ollama)
  if (process.env.CONTEXTUS_TEST_MODE === '1') {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  const lines = [];
  let warmOk = false;
  // Hoisted out of the `if (warmOk)` block below so the final additionalContext
  // check (after that block closes) can still see them.
  let quarantined = [];
  let failed = [];

  try {
    // Packaged install only: a marketplace clone has no node_modules. Kick off a
    // detached dep-install into ${CLAUDE_PLUGIN_DATA} BEFORE spawning the daemon.
    // No-op in dev / --plugin-dir. If it starts an install, the daemon this session
    // may degrade to no-injection; deps are ready next session (graceful).
    if (ensureDepsInstalled()) {
      lines.push(
        'contextus: installing dependencies (first launch only) — context injection will start once it finishes, likely next session.'
      );
    }
    // Install-from-main: dist/ is not committed, so build it on first run.
    // No-op in dev mode (tsx runs source) or if dist/ already exists.
    const buildResult = ensureDistBuilt();
    if (buildResult.built) {
      lines.push('contextus: built dist/ from source (first run only).');
    } else if (buildResult.reason === 'build-failed') {
      lines.push(
        'contextus: dist/ build failed — falling back to tsx (slower startup). Check that TypeScript compiles: npx tsc'
      );
    } else if (buildResult.reason === 'build-timeout') {
      lines.push(
        'contextus: dist/ build timed out — falling back to tsx. Try running `pnpm build` manually.'
      );
    } else if (buildResult.reason === 'lock-timeout') {
      lines.push(
        "contextus: waited for another session to build dist/ but it didn't finish — falling back to tsx."
      );
    } else if (buildResult.reason === 'no-local-tsc') {
      lines.push(
        'contextus: no local TypeScript compiler found — run setup to sync and build the neutral home (node scripts/sync-neutral-daemon.js).'
      );
    }
    const wasRunning = await ensureDaemonRunning();
    // If we spawned one, wait (bounded) for warm. Either way fetch /health so the
    // decision logic can see modelLoaded + warmupError (the silent-failure signal).
    // probe=true on existing daemons: verify the provider is still reachable (a
    // cheap embed) so we don't report "all good" when Ollama has since died.
    const warmModel = wasRunning ? false : await waitForModel({ attempts: 30, intervalMs: 500 });
    const health = await getHealth(2000, { probe: wasRunning });
    const status = resolveDaemonStatus({ wasRunning, warmModel, health, verbosity });
    warmOk = status.warmOk;
    if (status.message) lines.push(status.message);
  } catch {
    // The helpers swallow their own errors, so reaching here is unexpected — but
    // still must not block the session. A failure is always worth surfacing
    // unless explicitly silenced.
    lines.push(
      'contextus: could not start the context daemon; running without context injection this session.'
    );
  }

  // checkCorpus() ({check:true}) is a pure config/DB read on the daemon side
  // (see handleReconcile's check branch) — it does NOT require the embedding
  // model to be warm, unlike the real embed path (server-side gated on
  // modelLoaded separately). Fetching it unconditionally, not only inside
  // `if (warmOk)`, means transcript mining's config gate (piggybacked on this
  // same response) still works when the embedder is cold/broken but the
  // daemon process itself is otherwise reachable — mining needs a completely
  // different provider (the extraction LLM, Haiku via Bedrock/Ollama) and has
  // no business being blocked by the embedding model's health (independent
  // review of #40, item #6). checkCorpus has its own internal try/catch and
  // 1500ms timeout, so calling it here even when the daemon never came up at
  // all is safe — it just returns null quickly.
  const project = projectId(cwd);
  const plan = await checkCorpus(project, cwd);

  // Auto-reconcile: only meaningful once the model is warm (the daemon can't
  // embed cold). Fire the background reconcile only if the corpus is
  // actually missing or behind.
  if (warmOk) {
    const pending = plan ? (plan.newCount ?? 0) + (plan.changedCount ?? 0) : 0;
    if (plan && plan.state === 'missing') {
      await fireReconcile(project, cwd);
      lines.push(
        'contextus: corpus not built yet — embedding your .claude/context/ in the background; context will start flowing shortly.'
      );
    } else if (plan && plan.state === 'stale' && pending > 0) {
      // Only announce when there's actual embed work. A 'stale' plan with no
      // new/changed files (e.g. only orphan rows to drop) is silently reconciled —
      // never surface a nonsensical "re-embedding 0".
      await fireReconcile(project, cwd);
      lines.push(
        `contextus: corpus is behind your context files — re-embedding ${pending} in the background.`
      );
    } else if (plan && plan.state === 'stale') {
      // Orphan-only drift: reconcile quietly, no user-facing noise.
      await fireReconcile(project, cwd);
    }
  }

  // Transcript mining as recurring safety net (GH issue #39 — the engine
  // existed since PR #13 but nothing ever triggered it automatically; a
  // project's watermark could go stale for weeks with no signal). Off by
  // default — /contextus-setup asks and writes transcriptMining.enabled;
  // a project that never ran that flow stays off (real LLM cost/time, no
  // silent opt-in). When enabled, gated on a cadence (default 24h), not
  // every session start. Fire-and-forget: a real detached process, not
  // something this hook waits on (extraction calls an LLM per window).
  // Deliberately OUTSIDE `if (warmOk)` — see the comment on `plan` above.
  const mining = checkTranscriptMining(cwd, plan?.transcriptMining);
  if (mining.due) {
    fireTranscriptMining(cwd);
    lines.push(
      `contextus: mining ${mining.pending} recent session(s) for context that slipped through — running in the background.`
    );
  }

  if (warmOk) {
    // Surface quarantined files (bad prefix/type — can't embed). Honest + actionable:
    // these used to either abort the whole embed or loop as a phantom "new" forever.
    quarantined = plan && Array.isArray(plan.quarantined) ? plan.quarantined : [];
    if (quarantined.length > 0) {
      const shown = quarantined.slice(0, 3).join(', ');
      const more = quarantined.length > 3 ? ` (+${quarantined.length - 3} more)` : '';
      lines.push(
        `contextus: ${quarantined.length} context file(s) can't embed — filename prefix disagrees with metadata.type: ${shown}${more}. Fix the prefix or type; they won't inject until then.`
      );
    }

    // Surface files with invalid frontmatter YAML — a different failure stage
    // than the prefix/type mismatch above (the file never even parsed), so it
    // gets its own message rather than being silently absent or lumped in.
    failed = plan && Array.isArray(plan.failed) ? plan.failed : [];
    if (failed.length > 0) {
      const shown = failed.slice(0, 3).join(', ');
      const more = failed.length > 3 ? ` (+${failed.length - 3} more)` : '';
      lines.push(
        `contextus: ${failed.length} context file(s) can't embed — invalid frontmatter YAML: ${shown}${more}. Usually an unquoted ": " in a scalar value; they won't inject until fixed.`
      );
    }

    // Upgrade check: cheap (~1ms, two file reads). Notifies if data schema is behind
    // the installed code version. Never blocks, never auto-migrates.
    const upgrade = checkUpgradeNeeded();
    if (upgrade && upgrade.needed) {
      if (upgrade.hasBreakingChanges) {
        lines.push(`contextus: run /contextus-upgrade to migrate (breaking changes)`);
      } else {
        // No migration needed — stamp immediately so this notice fires once,
        // right after the real version bump, not on every session start.
        stampVersion(upgrade.installedVersion);
        lines.push(`contextus: updated to ${upgrade.installedVersion}`);
      }
    }

    // One-time nudge: only when the project lacks the CLAUDE.md stanza. Content-aware
    // so a MIGRATED project (corpus already populated) doesn't get told to "scaffold"
    // a dir that's already full — that wording reads as "nothing is set up" when in
    // fact contextus is live. Never edits the file — only suggests.
    if (!hasContextusStanza(cwd)) {
      lines.push(
        hasPopulatedContextDir(cwd)
          ? 'contextus: detected .claude/context/ — run /contextus-setup to register and start injecting.'
          : 'contextus: run /contextus-setup for guided setup (~2 min, or /contextus-setup --quick for defaults).'
      );
    }
  }

  // 'silent' suppresses everything, including failures.
  const out = { continue: true };
  if (lines.length && verbosity !== 'silent') out.systemMessage = lines.join('\n');

  // Unlike the rest of `lines` above, quarantined/failed context files are
  // worth putting in Claude's own context (not just the human-facing
  // systemMessage) — they're rare, bounded, and directly actionable by an
  // agent that can go fix the file right now, rather than only visible to a
  // human who happens to be reading the terminal. Deliberately NOT doing
  // this for the rest of `lines` (daemon-spawned, upgrade notices, setup
  // nudges) — those are routine status, not something worth spending every
  // session's context budget on (see the no-additionalContext-for-routine-
  // status note above).
  if (verbosity !== 'silent') {
    const contextIssues = [];
    if (quarantined.length > 0) {
      contextIssues.push(
        `${quarantined.length} file(s) with filename prefix disagreeing with metadata.type (fix the prefix or the type): ${quarantined.join(', ')}`
      );
    }
    if (failed.length > 0) {
      contextIssues.push(
        `${failed.length} file(s) with invalid frontmatter YAML, usually an unquoted ": " in a scalar value: ${failed.join(', ')}`
      );
    }
    if (contextIssues.length > 0) {
      out.hookSpecificOutput = {
        hookEventName: 'SessionStart',
        additionalContext: `[contextus] This project's context corpus has files that can't embed and won't be searchable until fixed:\n${contextIssues.map((i) => `- ${i}`).join('\n')}`
      };
    }
  }

  process.stdout.write(JSON.stringify(out));
}

main();
