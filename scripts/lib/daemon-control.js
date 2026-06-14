/**
 * daemon-control — shared daemon lifecycle helpers for the thin hooks.
 *
 * Plain ESM JavaScript (NOT TypeScript): hooks are invoked as
 * `node $PLUGIN_PATH/scripts/<hook>.js` with no build step, so they cannot
 * import the .ts libs. The DAEMON itself is .ts (run via tsx) — this util just
 * spawns and health-checks it over HTTP.
 *
 * The daemon is spawned via the repo-local `tsx` binary (the same launcher
 * Phase 0/1 scripts use). We resolve it relative to this file's location so it
 * works regardless of cwd or how $PLUGIN_PATH expands.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** repo root = two levels up from scripts/lib/ */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export const PORT = 37800;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

const RUNTIME_DIR = path.join(os.homedir(), '.contextus', 'runtime');
const PID_PATH = path.join(RUNTIME_DIR, 'daemon.pid');
const DAEMON_TS = path.join(REPO_ROOT, 'daemon', 'server.ts');
const EVAL_WORKER_TS = path.join(REPO_ROOT, 'daemon', 'eval-worker.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const PLUGIN_JSON = path.join(REPO_ROOT, 'plugin.json');

/** Valid notification verbosity levels (least → most chatty). */
export const VERBOSITY_LEVELS = ['silent', 'normal', 'verbose'];

/**
 * Resolve notification verbosity for the hooks. Precedence:
 *   1. CONTEXTUS_VERBOSITY env (quick testing / per-session override)
 *   2. plugin.json → config.notifications.verbosity
 *   3. 'normal' (code default)
 * Plain JS can't import config.ts, so this reads plugin.json directly — the same
 * file lib/config.ts reads, just the one field the hooks care about.
 */
export function getVerbosity() {
  const env = process.env.CONTEXTUS_VERBOSITY;
  if (env && VERBOSITY_LEVELS.includes(env)) return env;
  try {
    const cfg = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
    const v = cfg?.config?.notifications?.verbosity;
    if (VERBOSITY_LEVELS.includes(v)) return v;
  } catch {
    /* fall through to default */
  }
  return 'normal';
}

/** Format a daemon uptime (seconds) as a compact human string: 4h, 12m, 8s. */
export function formatUptime(seconds) {
  const s = Math.round(seconds || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

/** GET /health with a short timeout. Returns the parsed body or null on failure. */
export async function getHealth(timeoutMs = 1000) {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Spawn a detached tsx process (daemon or eval worker) that outlives the hook. */
function spawnDetached(scriptTs) {
  // Prefer the repo-local tsx binary; fall back to `npx tsx` if it's missing.
  const useBin = fs.existsSync(TSX_BIN);
  const cmd = useBin ? TSX_BIN : 'npx';
  const args = useBin ? [scriptTs] : ['tsx', scriptTs];
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

/** Spawn the daemon + the background eval worker, both detached. */
function spawnDaemon() {
  spawnDetached(DAEMON_TS);
  // The eval worker is a separate, idle-cheap process: it polls the eval queue
  // and only does work during a calibration campaign. Spawning it here means a
  // started campaign needs no manual worker launch. Its own EADDR-free design +
  // queue truncation make a duplicate spawn harmless (worst case: two pollers
  // racing a tiny file, last-write-wins on truncate).
  spawnDetached(EVAL_WORKER_TS);
}

/**
 * Ensure a healthy daemon is running. Returns true if one was ALREADY healthy,
 * false if we just spawned one (caller then polls /health for modelLoaded).
 *
 * Stale-PID handling: a PID file with a dead process (or an unreachable daemon)
 * is cleaned up before spawning a replacement.
 */
export async function ensureDaemonRunning() {
  const health = await getHealth(1000);
  if (health) return true;

  // Not reachable. Clean up a stale PID file if the process is gone.
  if (fs.existsSync(PID_PATH)) {
    try {
      const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
      if (pid) process.kill(pid, 0); // throws if the process doesn't exist
      // Process exists but /health failed → it's wedged; leave PID, still respawn.
    } catch {
      try {
        fs.unlinkSync(PID_PATH);
      } catch {
        /* best-effort */
      }
    }
  }

  spawnDaemon();
  return false;
}

/** Sleep helper for polling loops. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll /health until modelLoaded is true or attempts run out. Used by
 * session-start so the first real prompt hits a warm daemon. Does NOT block
 * forever — bounded so a broken daemon can't hang session startup.
 */
export async function waitForModel({ attempts = 30, intervalMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const health = await getHealth(1000);
    if (health && health.modelLoaded) return true;
    await sleep(intervalMs);
  }
  return false;
}
