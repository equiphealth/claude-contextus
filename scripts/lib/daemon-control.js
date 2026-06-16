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
const PORT_PATH = path.join(RUNTIME_DIR, 'daemon.port');
// Two launch targets per process: the compiled JS (shipped/packaged) and the
// TypeScript source (dev, run via tsx). resolveLaunch() picks per-process.
const DAEMON_JS = path.join(REPO_ROOT, 'dist', 'daemon', 'server.js');
const DAEMON_TS = path.join(REPO_ROOT, 'daemon', 'server.ts');
const EVAL_WORKER_JS = path.join(REPO_ROOT, 'dist', 'daemon', 'eval-worker.js');
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

/**
 * Dependency bootstrap for the PACKAGED plugin (marketplace install).
 *
 * A marketplace clone ships source + committed dist/ but NO node_modules — Claude
 * Code runs no install lifecycle (PACKAGING.md). The native deps (@lancedb / @xenova)
 * must be installed on the target machine into the PERSISTENT ${CLAUDE_PLUGIN_DATA}
 * dir (which survives plugin updates, unlike the ephemeral ${CLAUDE_PLUGIN_ROOT}),
 * and the daemon spawned with NODE_PATH pointing there.
 *
 * Guards (this is a strict NO-OP in dev / `--plugin-dir`):
 *   - Only acts when BOTH $CLAUDE_PLUGIN_ROOT and $CLAUDE_PLUGIN_DATA are set
 *     (i.e. a real packaged launch), AND the repo has no local node_modules.
 *   - Idempotent: skips when the installed package.json matches the plugin's
 *     (the documented `diff package.json` pattern) — so it installs once, then
 *     only re-runs after a dependency change.
 *
 * The install runs DETACHED in the background (a native lancedb build easily
 * exceeds the 20s SessionStart timeout). The daemon spawn this session may find
 * deps missing and degrade to no-injection; the NEXT session finds them ready.
 * This matches the existing graceful-degradation posture.
 *
 * NOTE: this path can only be exercised under a real marketplace install — it is
 * NOT reachable from a `--plugin-dir` dogfood session (node_modules present), so it
 * is unverified locally by design. See PACKAGING.md.
 */
const PLUGIN_DATA = process.env.CLAUDE_PLUGIN_DATA || null;

/** node_modules dir the daemon should load from: managed data dir if packaged, else repo. */
export function depsNodeModules() {
  if (PLUGIN_DATA && !fs.existsSync(path.join(REPO_ROOT, 'node_modules'))) {
    return path.join(PLUGIN_DATA, 'node_modules');
  }
  return path.join(REPO_ROOT, 'node_modules');
}

/** True when we're a packaged launch that needs deps installed into PLUGIN_DATA. */
function needsDepBootstrap() {
  if (!PLUGIN_DATA) return false; // dev / --plugin-dir → no-op
  if (fs.existsSync(path.join(REPO_ROOT, 'node_modules'))) return false; // repo has deps
  // Idempotency: installed package.json matches the plugin's → already bootstrapped.
  try {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8');
    const installed = fs.readFileSync(path.join(PLUGIN_DATA, 'package.json'), 'utf8');
    if (src === installed && fs.existsSync(path.join(PLUGIN_DATA, 'node_modules'))) return false;
  } catch {
    /* no installed package.json yet → needs install */
  }
  return true;
}

/**
 * Ensure packaged deps are installed into ${CLAUDE_PLUGIN_DATA}. Fires a DETACHED
 * `npm install` (copying the plugin's package.json first) and returns immediately
 * with `true` if it kicked off an install, `false` if nothing to do. Never throws.
 */
export function ensureDepsInstalled() {
  if (!needsDepBootstrap()) return false;
  try {
    fs.mkdirSync(PLUGIN_DATA, { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(PLUGIN_DATA, 'package.json'));
    // --omit=dev: runtime deps only (tsx/eslint/etc. not needed — we run dist/ JS).
    const child = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: PLUGIN_DATA,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return true;
  } catch {
    return false; // best-effort; daemon will degrade to no-injection until deps land
  }
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

/**
 * Resolve how to launch a daemon process. Prefers the COMPILED JS
 * (`node dist/daemon/X.js`) — the packaged/shipped path, no tsx at runtime. Falls
 * back to `tsx X.ts` only when the build is absent (dev working in the repo before
 * `npm run build`). Returns { cmd, args } for spawn().
 */
function resolveLaunch(jsPath, tsPath) {
  if (fs.existsSync(jsPath)) {
    return { cmd: process.execPath, args: [jsPath] }; // node dist/.../X.js
  }
  // Dev fallback: no build present → run the .ts via tsx (repo-local, else npx).
  const useBin = fs.existsSync(TSX_BIN);
  return useBin ? { cmd: TSX_BIN, args: [tsPath] } : { cmd: 'npx', args: ['tsx', tsPath] };
}

/** Spawn a detached daemon process that outlives the hook. */
function spawnDetached(jsPath, tsPath) {
  const { cmd, args } = resolveLaunch(jsPath, tsPath);
  // Packaged launches load native deps from ${CLAUDE_PLUGIN_DATA}/node_modules via
  // NODE_PATH (the repo has none). In dev this resolves to the repo's own
  // node_modules — a harmless explicit no-op (Node already searches it).
  const env = { ...process.env, NODE_PATH: depsNodeModules() };
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
}

/** Spawn the daemon + the background eval worker, both detached. */
function spawnDaemon() {
  spawnDetached(DAEMON_JS, DAEMON_TS);
  // The eval worker is a separate, idle-cheap process: it polls the eval queue
  // and only does work during a calibration campaign. Spawning it here means a
  // started campaign needs no manual worker launch. Its own EADDR-free design +
  // queue truncation make a duplicate spawn harmless (worst case: two pollers
  // racing a tiny file, last-write-wins on truncate).
  spawnDetached(EVAL_WORKER_JS, EVAL_WORKER_TS);
}

/**
 * Ensure a healthy daemon is running. Returns true if one was ALREADY healthy,
 * false if we just spawned one (caller then polls /health for modelLoaded).
 *
 * Crash-recovery / stale-PID handling — three cases when /health doesn't answer:
 *   1. No PID file, or PID points at a dead process → a clean crash. Clear the
 *      stale runtime files and spawn fresh.
 *   2. PID is alive but /health is unreachable → a WEDGED daemon still holding
 *      the port. Just spawning would lose the EADDRINUSE race (the new process
 *      exits, nothing recovers). So we KILL the wedged process first, wait for
 *      the port to free, then spawn. This is the kill-mid-session recovery path.
 *   3. PID is alive AND /health answered → handled above (returns true).
 */
export async function ensureDaemonRunning() {
  const health = await getHealth(1000);
  if (health) return true;

  const pid = readPid();
  if (pid && pidAlive(pid)) {
    // Wedged: process is up but not serving /health. Evict it so the port frees
    // and our respawn can bind (otherwise it'd EADDRINUSE-exit and never heal).
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* may have just died — fine */
    }
    // Give it a moment to release the socket (its SIGTERM handler closes + unrefs).
    for (let i = 0; i < 10; i++) {
      await sleep(100);
      if (!pidAlive(pid)) break;
    }
    if (pidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* best-effort */
      }
    }
  }

  // Either a clean crash (dead/no PID) or a freshly-evicted wedge — clear the
  // runtime files so the next daemon writes its own, and spawn.
  clearRuntimeFiles();
  spawnDaemon();
  return false;
}

/** Read the daemon PID from the PID file, or null if absent/unparseable. */
function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf8'), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Is this PID a live process? `kill(pid, 0)` throws ESRCH if it isn't. */
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it → still alive.
    return err && err.code === 'EPERM';
  }
}

/** Best-effort removal of the stale PID + port runtime files. */
function clearRuntimeFiles() {
  for (const p of [PID_PATH, PORT_PATH]) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}

/** The marked, idempotent stanza fences /contextus-setup writes into CLAUDE.md. */
export const STANZA_START = '<!-- contextus:start -->';
export const STANZA_END = '<!-- contextus:end -->';

/**
 * Does the project CLAUDE.md already carry the contextus stanza? Used by
 * session-start for the one-time "run /contextus-setup" nudge. A missing file
 * counts as "no stanza". Reads the file directly (plain JS, no config import).
 */
export function hasContextusStanza(cwd) {
  const file = path.join(cwd || process.cwd(), 'CLAUDE.md');
  try {
    return fs.readFileSync(file, 'utf8').includes(STANZA_START);
  } catch {
    return false; // no CLAUDE.md → no stanza
  }
}

/**
 * Is `.claude/context/` already populated with real context files? Used to tell a
 * MIGRATED project (corpus exists, stanza missing) apart from a FRESH one (nothing
 * yet) so the session-start nudge can say the right thing — "scaffold" is wrong
 * when the dir is already full. Counts any `.md` except the CONTEXT.md/README index
 * files, recursively (context nests by type). Plain JS, no config import.
 */
export function hasPopulatedContextDir(cwd) {
  const dir = path.join(cwd || process.cwd(), '.claude', 'context');
  const SKIP = new Set(['CONTEXT.md', 'README.md']);
  let stack = [dir];
  try {
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
        else if (ent.name.endsWith('.md') && !SKIP.has(ent.name)) return true;
      }
    }
  } catch {
    return false; // no .claude/context/ dir → not populated
  }
  return false;
}

/** POST /reconcile with `check:true` — returns the corpus state plan, or null. */
export async function checkCorpus(project, cwd, timeoutMs = 1500) {
  try {
    const res = await fetch(`${BASE_URL}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, cwd, check: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** POST /reconcile (no check) — fire the background reconcile. Returns body or null. */
export async function fireReconcile(project, cwd, timeoutMs = 2000) {
  try {
    const res = await fetch(`${BASE_URL}/reconcile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project, cwd }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
export async function waitForModel({ attempts, intervalMs } = {}) {
  // Bounds are env-tunable so tests/CI can keep the spawn path fast without
  // leaving a daemon mid-warm; production session-start uses the defaults.
  const maxAttempts = attempts ?? (Number(process.env.CONTEXTUS_WARM_ATTEMPTS) || 30);
  const wait = intervalMs ?? (Number(process.env.CONTEXTUS_WARM_INTERVAL_MS) || 500);
  for (let i = 0; i < maxAttempts; i++) {
    const health = await getHealth(1000);
    if (health && health.modelLoaded) return true;
    await sleep(wait);
  }
  return false;
}
