#!/usr/bin/env node
/**
 * SessionStart hook — ensure the daemon is up and warm before the first prompt.
 *
 * Thin ESM JS (no build step). Spawns the daemon if needed, then polls /health
 * until the model is warm (bounded — never hangs session start). Whatever
 * happens, it emits `{ continue: true }` so a daemon problem never blocks the
 * session; a cold first prompt just degrades to no-injection (DESIGN.md graceful
 * degradation).
 *
 * Transparency (user preference: surface what the system did). We report daemon
 * state via `systemMessage` — which renders to the USER in the UI, NOT to
 * Claude's context. We deliberately never use `additionalContext` for this:
 * announcing the daemon to Claude every session would pollute the very context
 * window contextus exists to keep clean.
 *
 * Verbosity (config.notifications.verbosity, or CONTEXTUS_VERBOSITY env):
 *   silent  — never emit a message
 *   normal  — only noteworthy events: fresh spawn, still-warming, failure
 *   verbose — the above PLUS a heartbeat when an existing warm daemon is found
 */

import { ensureDaemonRunning, waitForModel, getHealth, getVerbosity, formatUptime } from './lib/daemon-control.js';

async function main() {
  const verbosity = getVerbosity();
  let systemMessage;

  try {
    const wasRunning = await ensureDaemonRunning();
    if (wasRunning) {
      // Happy path: an existing warm daemon. Heartbeat only at 'verbose'.
      if (verbosity === 'verbose') {
        const health = await getHealth(1000);
        const up = health ? ` (uptime ${formatUptime(health.uptime)})` : '';
        systemMessage = `contextus: using the running daemon${up}.`;
      }
    } else {
      // We just spawned one — wait (bounded) for the model to warm.
      const warm = await waitForModel({ attempts: 30, intervalMs: 500 });
      systemMessage = warm
        ? 'contextus: started a new daemon (model warm, ready to inject).'
        : 'contextus: started a new daemon — model still warming; the first prompt or two may not get context yet.';
    }
  } catch {
    // The helpers swallow their own errors, so reaching here is unexpected — but
    // still must not block the session. A failure is always worth surfacing
    // unless explicitly silenced.
    systemMessage = 'contextus: could not start the context daemon; running without context injection this session.';
  }

  // 'silent' suppresses everything, including failures.
  const out = { continue: true };
  if (systemMessage && verbosity !== 'silent') out.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(out));
}

main();
