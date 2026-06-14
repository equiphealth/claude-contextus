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

import path from 'path';
import {
  ensureDaemonRunning,
  waitForModel,
  getHealth,
  getVerbosity,
  formatUptime,
  checkCorpus,
  fireReconcile,
  hasContextusStanza,
} from './lib/daemon-control.js';

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

/** Project name = cwd basename — matches the daemon's resolveDBPath default. */
function projectName(cwd) {
  return cwd ? path.basename(cwd) : path.basename(process.cwd());
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

  const lines = [];
  let warmOk = false;

  try {
    const wasRunning = await ensureDaemonRunning();
    if (wasRunning) {
      warmOk = true;
      if (verbosity === 'verbose') {
        const health = await getHealth(1000);
        const up = health ? ` (uptime ${formatUptime(health.uptime)})` : '';
        lines.push(`contextus: using the running daemon${up}.`);
      }
    } else {
      // We just spawned one — wait (bounded) for the model to warm.
      warmOk = await waitForModel({ attempts: 30, intervalMs: 500 });
      lines.push(
        warmOk
          ? 'contextus: started a new daemon (model warm, ready to inject).'
          : 'contextus: started a new daemon — model still warming; the first prompt or two may not get context yet.'
      );
    }
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
    const project = projectName(cwd);
    const plan = await checkCorpus(project, cwd);
    if (plan && (plan.state === 'missing' || plan.state === 'stale')) {
      await fireReconcile(project, cwd);
      lines.push(
        plan.state === 'missing'
          ? 'contextus: corpus not built yet — embedding your .claude/context/ in the background; context will start flowing shortly.'
          : `contextus: corpus is behind your context files — re-embedding ${plan.newCount + plan.changedCount} in the background.`
      );
    }

    // One-time nudge: if the project hasn't been set up (no marked stanza in
    // CLAUDE.md), point at /contextus-setup. Never edits the file — only suggests.
    if (!hasContextusStanza(cwd)) {
      lines.push(
        'contextus: run /contextus-setup to scaffold .claude/context/ and register contextus in this project (one-time).'
      );
    }
  }

  // 'silent' suppresses everything, including failures.
  const out = { continue: true };
  if (lines.length && verbosity !== 'silent') out.systemMessage = lines.join('\n');
  process.stdout.write(JSON.stringify(out));
}

main();
