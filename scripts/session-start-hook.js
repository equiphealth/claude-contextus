#!/usr/bin/env node
/**
 * SessionStart hook — ensure the daemon is up and warm before the first prompt.
 *
 * Thin ESM JS (no build step). Spawns the daemon if needed, then polls /health
 * until the model is warm (bounded — never hangs session start). Whatever
 * happens, it emits `{ continue: true }` so a daemon problem never blocks the
 * session; a cold first prompt just degrades to no-injection (DESIGN.md graceful
 * degradation).
 */

import { ensureDaemonRunning, waitForModel } from './lib/daemon-control.js';

async function main() {
  try {
    const wasRunning = await ensureDaemonRunning();
    if (!wasRunning) {
      // Freshly spawned — give it bounded time to load the model.
      await waitForModel({ attempts: 30, intervalMs: 500 });
    }
  } catch {
    /* never block session start on a daemon issue */
  }
  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
