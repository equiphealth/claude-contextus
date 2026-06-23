#!/usr/bin/env node
/**
 * Eval worker — background calibration grader (evaluation-architecture memory).
 *
 * Runs as a detached process alongside the daemon. It POLLS the eval queue on a
 * fixed interval and drains it — deliberately NOT fs.watch, which the BUILD_LOG
 * Phase 3+4 note flagged as cross-platform-unreliable (missed/double events on
 * network + FUSE mounts). Polling at this volume (≤1 job per Claude response) is
 * trivially cheap and never misses.
 *
 * Everything testable lives in lib/eval-worker-core.ts (mockable model caller);
 * this wrapper is just the loop + lifecycle, which we don't unit-test (per the
 * estimate's "do NOT unit-test the eval worker process" guidance).
 */

import fs from 'node:fs';
import path from 'node:path';
import { drainQueue } from '../lib/calibration/eval-worker-core.js';
import { readState } from '../lib/calibration/calibration-state.js';
import { logInfo, logError } from '../lib/logger.js';
import { expandHome } from '../lib/config.js';

const POLL_MS = 5_000;
const PID_PATH = expandHome('~/.contextus/runtime/eval-worker.pid');

/**
 * Singleton guard: ensureDaemonRunning spawns the worker whenever the daemon is
 * cold, so a duplicate is possible. Two pollers racing the queue truncate could
 * drop a job. If a live worker already holds the PID file, this one exits.
 */
function claimSingleton(): boolean {
  try {
    if (fs.existsSync(PID_PATH)) {
      const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0); // throws if the holder is dead
          return false; // a live worker already owns it
        } catch {
          /* stale pid — fall through and claim it */
        }
      }
    }
    fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
    fs.writeFileSync(PID_PATH, String(process.pid));
    return true;
  } catch {
    return true; // if we can't manage the lock, run anyway (best-effort)
  }
}

if (!claimSingleton()) {
  logInfo('Eval worker already running — exiting duplicate');
  process.exit(0);
}

async function tick(): Promise<void> {
  // Cheap guard: when no campaign is active, do nothing (the queue shouldn't
  // grow either, since /query only stashes jobs while evaluateUsage is true).
  if (!readState().evaluateUsage) return;
  try {
    const n = await drainQueue();
    if (n > 0) {
      const s = readState();
      logInfo('Calibration drained', {
        processed: n,
        total: `${s.sampleCount}/${s.targetSamples}`
      });
      if (!s.evaluateUsage && s.completedAt) {
        logInfo('Calibration complete', { samples: s.sampleCount });
      }
    }
  } catch (err) {
    logError('error', 'eval-worker', 'drain failed', {
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

logInfo('Eval worker started', { pollMs: POLL_MS });
const timer = setInterval(() => {
  void tick();
}, POLL_MS);
timer.unref?.();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(timer);
    try {
      if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH);
    } catch {
      /* best-effort */
    }
    logInfo('Eval worker stopping', { signal: sig });
    process.exit(0);
  });
}

// Run one drain immediately on boot so a restart picks up any queued jobs.
void tick();
