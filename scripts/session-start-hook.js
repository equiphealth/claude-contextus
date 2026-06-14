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
 * Transparency (user preference: surface what the system did, don't hide it): we
 * report daemon state via `systemMessage` — which renders to the USER in the UI,
 * NOT to Claude's context. We deliberately do NOT use `additionalContext` for
 * this: telling Claude "daemon spawned" on every session would pollute the very
 * context window contextus exists to keep clean. We stay SILENT on the common
 * happy path (found a warm daemon) and only speak when something is noteworthy:
 * a fresh spawn, a still-warming daemon, or a failure to come up.
 */

import { ensureDaemonRunning, waitForModel } from './lib/daemon-control.js';

async function main() {
  let systemMessage;
  try {
    const wasRunning = await ensureDaemonRunning();
    if (wasRunning) {
      // Happy path: an existing warm daemon. Say nothing.
    } else {
      // We just spawned one — wait (bounded) for the model to warm.
      const warm = await waitForModel({ attempts: 30, intervalMs: 500 });
      systemMessage = warm
        ? 'contextus: started a new daemon (model warm, ready to inject).'
        : 'contextus: started a new daemon — model still warming; the first prompt or two may not get context yet.';
    }
  } catch {
    // ensureDaemonRunning/waitForModel swallow their own errors, so reaching here
    // is unexpected — but still must not block the session.
    systemMessage = 'contextus: could not start the context daemon; running without context injection this session.';
  }

  const out = { continue: true };
  if (systemMessage) out.systemMessage = systemMessage;
  process.stdout.write(JSON.stringify(out));
}

main();
