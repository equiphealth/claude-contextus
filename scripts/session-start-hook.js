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
  hasContextusStanza,
  hasPopulatedContextDir,
  checkUpgradeNeeded,
} from './lib/daemon-control.js';
import { resolveDaemonStatus } from './lib/daemon-status.js';

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

  // Auto-reconcile: only meaningful once the model is warm (the daemon can't
  // embed cold). Cheap dry-run check first; fire the background reconcile only
  // if the corpus is actually missing or behind.
  if (warmOk) {
    const project = projectId(cwd);
    const plan = await checkCorpus(project, cwd);
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

    // Surface quarantined files (bad prefix/type — can't embed). Honest + actionable:
    // these used to either abort the whole embed or loop as a phantom "new" forever.
    const quarantined = plan && Array.isArray(plan.quarantined) ? plan.quarantined : [];
    if (quarantined.length > 0) {
      const shown = quarantined.slice(0, 3).join(', ');
      const more = quarantined.length > 3 ? ` (+${quarantined.length - 3} more)` : '';
      lines.push(
        `contextus: ${quarantined.length} context file(s) can't embed — filename prefix disagrees with metadata.type: ${shown}${more}. Fix the prefix or type; they won't inject until then.`
      );
    }

    // Upgrade check: cheap (~1ms, two file reads). Notifies if data schema is behind
    // the installed code version. Never blocks, never auto-migrates.
    const upgrade = checkUpgradeNeeded();
    if (upgrade && upgrade.needed) {
      lines.push(
        `contextus: upgrade available (${upgrade.dataVersion} → ${upgrade.installedVersion}) — run /contextus-upgrade when ready.`
      );
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
  process.stdout.write(JSON.stringify(out));
}

main();
