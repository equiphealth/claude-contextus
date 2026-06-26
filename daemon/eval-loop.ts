/**
 * Eval loop — background queue drainer for usage evaluation.
 *
 * Polls the eval queue every 5 seconds and drains it when non-empty. Separated
 * from the main daemon server to keep the retrieval hot path clean. Respects
 * the campaign's evaluateUsage flag — stops calling the model when disabled.
 *
 * Runs as a setInterval that's unref'd so it doesn't keep the daemon alive.
 */

import { drainQueue } from '../lib/calibration/eval-worker-core.js';
import { readState } from '../lib/calibration/calibration-state.js';
import { logInfo, logError } from '../lib/logger.js';

const POLL_INTERVAL_MS = 5_000; // check queue every 5s
let timer: ReturnType<typeof setInterval> | null = null;

export function startEvalLoop(): void {
  if (timer) return;
  timer = setInterval(async () => {
    const state = readState();
    if (!state.evaluateUsage) return; // respects campaign off-switch
    try {
      const processed = await drainQueue();
      if (processed > 0) {
        logInfo('Eval loop drained', { processed });
      }
    } catch (err) {
      logError('warn', 'eval-loop', 'Drain failed', {
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }, POLL_INTERVAL_MS);
  timer.unref(); // don't keep daemon alive solely for eval
}

export function stopEvalLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
