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

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** repo root = two levels up from scripts/lib/ */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** Preferred daemon port (fallback if daemon.port file doesn't exist). */
export const PREFERRED_PORT = 37800;

const RUNTIME_DIR = path.join(os.homedir(), '.contextus', 'runtime');
const PID_PATH = path.join(RUNTIME_DIR, 'daemon.pid');
const PORT_PATH = path.join(RUNTIME_DIR, 'daemon.port');

/**
 * Base URL for daemon HTTP API (cached for process lifetime).
 * Priority: CONTEXTUS_DAEMON_URL env var > daemon.port file > PREFERRED_PORT (37800)
 *
 * NOTE: This is a plain JS implementation to avoid build dependencies. TypeScript
 * scripts should import getDaemonURL() from lib/daemon-url.ts instead.
 * Both implementations must stay in sync.
 */
let cachedURL = null;
export function getBaseURL() {
  if (cachedURL) {
    return cachedURL;
  }
  // 1. Check env var (set by daemon-config.sh or user override)
  if (process.env.CONTEXTUS_DAEMON_URL) {
    cachedURL = process.env.CONTEXTUS_DAEMON_URL;
    return cachedURL;
  }

  // 2. Read actual port from runtime file (written by daemon at startup)
  try {
    if (fs.existsSync(PORT_PATH)) {
      const content = fs.readFileSync(PORT_PATH, 'utf-8').trim();
      const port = parseInt(content, 10);
      if (port > 0 && port < 65536) {
        cachedURL = `http://127.0.0.1:${port}`;
        return cachedURL;
      }
    }
  } catch {
    // File doesn't exist or is unreadable — fall through
  }

  // 3. Fall back to preferred port
  const port = parseInt(process.env.CONTEXTUS_DAEMON_PORT || String(PREFERRED_PORT), 10);
  cachedURL = `http://127.0.0.1:${port}`;
  return cachedURL;
}
// Two launch targets per process: the compiled JS (shipped/packaged) and the
// TypeScript source (dev, run via tsx). resolveLaunch() picks per-process.
const DAEMON_JS = path.join(REPO_ROOT, 'dist', 'daemon', 'server.js');
const DAEMON_TS = path.join(REPO_ROOT, 'daemon', 'server.ts');
const EVAL_WORKER_JS = path.join(REPO_ROOT, 'dist', 'daemon', 'eval-worker.js');
const EVAL_WORKER_TS = path.join(REPO_ROOT, 'daemon', 'eval-worker.ts');
const MINE_TRANSCRIPTS_JS = path.join(REPO_ROOT, 'dist', 'scripts', 'mine-transcripts.js');
const MINE_TRANSCRIPTS_TS = path.join(REPO_ROOT, 'scripts', 'mine-transcripts.ts');
const TSX_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');

/**
 * Neutral daemon home (§3.3): host-shared code + deps + build. `~/.contextus/`
 * is already the neutral runtime home (runtime/ pid+port, data/ unified DB);
 * this extends it to the daemon code path, replacing the vague "setup-owned
 * runtime location" and the Claude-only CLAUDE_PLUGIN_DATA branch (kept as a
 * legacy fallback below). Hooks never write here; setup syncs it; the daemon
 * runs from it. Both hosts share one neutral copy — no Muse twin, no fork.
 */
export const NEUTRAL_DIR = path.join(os.homedir(), '.contextus', 'daemon');
const NEUTRAL_PKG = path.join(NEUTRAL_DIR, 'package.json');
const NEUTRAL_MODULES = path.join(NEUTRAL_DIR, 'node_modules');
const NEUTRAL_TSC = path.join(NEUTRAL_MODULES, 'typescript', 'bin', 'tsc');
const NEUTRAL_TSX_BIN = path.join(NEUTRAL_MODULES, '.bin', 'tsx');
export const NEUTRAL_DIST_SERVER = path.join(NEUTRAL_DIR, 'dist', 'daemon', 'server.js');
const NEUTRAL_DIST_WORKER = path.join(NEUTRAL_DIR, 'dist', 'daemon', 'eval-worker.js');
const NEUTRAL_VERSION_FILE = path.join(NEUTRAL_DIR, 'version.json');
// Source dirs + files synced repo → neutral (a closed, buildable set: no
// lib/ or daemon/ source imports outside it, verified 2026-10-27).
const NEUTRAL_SYNC_DIRS = ['daemon', 'lib', 'scripts'];
const NEUTRAL_SYNC_FILES = ['package.json', 'tsconfig.json'];

/** Repo version (what the neutral copy must match). Cached per process. */
let _repoVersion = undefined;
export function repoVersion() {
  if (_repoVersion === undefined) {
    try {
      _repoVersion =
        JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version || null;
    } catch {
      _repoVersion = null;
    }
  }
  return _repoVersion;
}

/**
 * Neutral-copy state for setup decisions. `ready` means version-stamped AND
 * deps AND dist all present. Anything else names the exact gap; setup (never
 * a hook) closes it via syncNeutralDaemon.
 */
export function neutralDaemonStatus() {
  const expected = repoVersion();
  let stamp = null;
  try {
    stamp = JSON.parse(fs.readFileSync(NEUTRAL_VERSION_FILE, 'utf8'));
  } catch {
    /* missing stamp → missing copy */
  }
  if (!stamp) return { state: 'missing', expected, found: null };
  if (expected && stamp.version !== expected)
    return { state: 'stale-version', expected, found: stamp.version };
  if (!fs.existsSync(NEUTRAL_MODULES)) return { state: 'missing-deps', expected, found: stamp.version };
  if (!fs.existsSync(NEUTRAL_DIST_SERVER))
    return { state: 'missing-dist', expected, found: stamp.version };
  return { state: 'ready', expected, found: stamp.version };
}

/** True when the neutral copy is version-stamped with deps and dist present. */
export function neutralDaemonReady() {
  return neutralDaemonStatus().state === 'ready';
}

/**
 * Running-daemon reuse comes before code path resolution (2026-10-27): a
 * healthy daemon is reused regardless of where its code lives — plugin,
 * repo, or neutral. A version mismatch is logged explicitly and NEVER
 * auto-upgraded under a live session; restart picks up the new code.
 * Warn-only: returns nothing, throws nothing.
 */
export function noteDaemonVersion(health) {
  try {
    const running = health && typeof health.version === 'string' ? health.version : null;
    const expected = repoVersion();
    if (running && expected && running !== expected) {
      console.error(
        `[contextus] daemon version ${running} != expected ${expected} — leaving the running daemon alone; restart it to upgrade (never auto-upgraded under a live session).`
      );
    }
  } catch {
    /* warn-only */
  }
}
import { stripJsonComments } from './parse-jsonc.js';
const PLUGIN_JSONC = path.join(REPO_ROOT, 'plugin.jsonc');
const PLUGIN_JSON = fs.existsSync(PLUGIN_JSONC) ? PLUGIN_JSONC : path.join(REPO_ROOT, 'plugin.json');

/**
 * Build dist/ if missing or incomplete (install-from-main users). Checks a few
 * critical files, not just the daemon entry — catches partial builds from a
 * prior timeout/crash. Uses a lockfile to prevent concurrent tsc invocations
 * from parallel session starts (harmless but wasteful).
 *
 * Returns { built: true } on success, { built: false, reason: string } on
 * skip/failure. The caller uses `reason` to surface a warning to the user.
 */
const DIST_SENTINEL_FILES = [
  DAEMON_JS,
  path.join(REPO_ROOT, 'dist', 'lib', 'config.js'),
  path.join(REPO_ROOT, 'dist', 'lib', 'retrieval', 'inject-format.js'),
];
const BUILD_LOCK = path.join(RUNTIME_DIR, 'build.lock');
const BUILD_TIMEOUT_MS = 60000; // 60s — full type-check on slow machines
const REPO_TSC = path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

export function ensureDistBuilt() {
  if (isDevMode()) return { built: false, reason: 'dev-mode' };
  if (DIST_SENTINEL_FILES.every((f) => fs.existsSync(f))) return { built: false, reason: 'exists' };
  // Lockfile guard: skip if another session is already building.
  // Stale lock cleanup: if the lock is older than 90s, the builder likely crashed.
  try {
    const lockStat = fs.statSync(BUILD_LOCK);
    if (Date.now() - lockStat.mtimeMs > 90000) fs.unlinkSync(BUILD_LOCK);
  } catch {
    /* no lock file — fine */
  }
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const lockFd = fs.openSync(BUILD_LOCK, 'wx'); // fails if file exists
    fs.closeSync(lockFd);
  } catch {
    // Lock exists — another session is building. Poll for completion (max 60s),
    // then fall back to tsx if dist/ still isn't ready.
    const deadline = Date.now() + BUILD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (DIST_SENTINEL_FILES.every((f) => fs.existsSync(f)))
        return { built: false, reason: 'exists' };
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    return { built: false, reason: 'lock-timeout' };
  }
  // Local tsc only — never npx (network fetch at hook time). Repo checkout
  // tsc first (dev), neutral setup-owned tsc second. Neither present (lean
  // install without setup) → report, don't fetch; the hook falls back to
  // tsx or degrades, setup fails loudly on its own path.
  const localTsc = [REPO_TSC, NEUTRAL_TSC].find((t) => fs.existsSync(t));
  if (!localTsc) return { built: false, reason: 'no-local-tsc' };
  try {
    execSync(`"${process.execPath}" "${localTsc}"`, {
      cwd: REPO_ROOT,
      stdio: 'ignore',
      timeout: BUILD_TIMEOUT_MS
    });
    return { built: true };
  } catch (err) {
    const reason = err?.killed ? 'build-timeout' : 'build-failed';
    return { built: false, reason };
  } finally {
    try {
      fs.unlinkSync(BUILD_LOCK);
    } catch {
      /* best-effort */
    }
  }
}

/** Last ~1500 chars of command output for failure reports. */
function tailOutput(s) {
  const t = String(s || '');
  return t.length > 1500 ? `…${t.slice(-1500)}` : t;
}

/**
 * Sync the neutral daemon home (SETUP ONLY — never called from a hook).
 * Idempotent: a `ready` copy is a no-op. Steps: wipe code (the npm cache
 * survives — it is not code), copy source dirs, FULL `npm install` (no
 * --omit=dev: omit+explicit mis-resolves when explicits are dev-listed, so
 * the full tree is the only deterministic one), build with the LOCAL tsc,
 * verify sentinels, write the version stamp.
 *
 * Setup pays the build cost once, inside its own step: no hook ever builds,
 * and a broken build fails the setup loudly instead of degrading silently at
 * session start. No npx anywhere on this path — no network fetch, no hook
 * timeout risk. Throws on any failure; the caller reports it verbatim.
 */
export function syncNeutralDaemon({ log = () => {}, npmCache, force = false } = {}) {
  const expected = repoVersion();
  if (!expected) throw new Error(`cannot read version from ${path.join(REPO_ROOT, 'package.json')}`);
  const prior = neutralDaemonStatus();
  if (prior.state === 'ready' && !force) {
    log(`neutral daemon ${prior.found} already in sync`);
    return { synced: false, ...prior };
  }
  log(`syncing neutral daemon (was: ${prior.state}, want: ${expected})`);

  // 1. Code sync. Wipe everything except the npm cache: no stale files
  // survive a version change, and the cache survives the wipe.
  fs.mkdirSync(NEUTRAL_DIR, { recursive: true });
  for (const ent of fs.readdirSync(NEUTRAL_DIR)) {
    if (ent === '.npm-cache') continue;
    fs.rmSync(path.join(NEUTRAL_DIR, ent), { recursive: true, force: true });
  }
  for (const d of NEUTRAL_SYNC_DIRS) {
    const src = path.join(REPO_ROOT, d);
    if (!fs.existsSync(src)) throw new Error(`sync source missing: ${src}`);
    fs.cpSync(src, path.join(NEUTRAL_DIR, d), { recursive: true });
  }
  for (const f of NEUTRAL_SYNC_FILES) {
    const src = path.join(REPO_ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`sync source missing: ${src}`);
    fs.copyFileSync(src, path.join(NEUTRAL_DIR, f));
  }

  // 2. Deps: FULL install, deliberately no --omit=dev. npm's omit+explicit
  // interaction is unreliable when the explicit packages are also dev-listed
  // (observed 2026-10-27: exit 0 with a dev-populated tree MISSING the
  // explicit typescript/tsx — a silent wrong tree, the worst outcome for a
  // setup step). Full install is deterministic: tree == repo dev tree, so
  // the neutral build matches the repo build bit-for-bit, tsx fallback
  // included. Cost is disk only (per-machine dir, never shipped).
  // Setup-owned cache always: never depends on ~/.npm being writable
  // (root-owned ~/.npm is a known env failure).
  const npmEnv = { ...process.env, npm_config_cache: npmCache || path.join(NEUTRAL_DIR, '.npm-cache') };
  const npmRun = (args) =>
    spawnSync('npm', args, { cwd: NEUTRAL_DIR, env: npmEnv, encoding: 'utf8', timeout: 300000 });
  // Lifecycle scripts RUN (no --ignore-scripts): @xenova/transformers pulls
  // sharp, whose postinstall downloads the native binding — skipping scripts
  // produces a tree that installs clean and crashes at boot (observed
  // 2026-10-27: "Cannot find module .../sharp-darwin-arm64v8.node"). This
  // matches repo behavior (pnpm runs scripts). The one repo script that must
  // not touch the neutral copy is `prepare` (git hooks into .githooks) —
  // neutralised by giving the neutral dir its own throwaway git repo first
  // (never committed to, never read by anything).
  const gitInit = spawnSync('git', ['init', '-q'], {
    cwd: NEUTRAL_DIR,
    encoding: 'utf8',
    timeout: 30000
  });
  if (gitInit.status !== 0) {
    throw new Error(
      'git is required for neutral setup (initialises the neutral dir so lifecycle scripts behave). ' +
        `Install git and rerun. Detail: ${tailOutput(gitInit.stderr || gitInit.error?.message)}`
    );
  }
  const r = npmRun(['install', '--no-audit', '--no-fund']);
  if (r.status !== 0)
    throw new Error(
      `neutral npm install failed (status=${r.status} signal=${r.signal || 'none'} spawnError=${(r.error && r.error.message) || 'none'}):\n${tailOutput(r.stderr || r.stdout)}`
    );
  log('deps installed (full tree incl. lifecycle scripts)');

  // 3. Build with the LOCAL tsc. Never npx (see contract above).
  if (!fs.existsSync(NEUTRAL_TSC)) throw new Error(`local tsc missing after install: ${NEUTRAL_TSC}`);
  const b = spawnSync(process.execPath, [NEUTRAL_TSC], {
    cwd: NEUTRAL_DIR,
    encoding: 'utf8',
    timeout: 300000
  });
  if (b.status !== 0)
    throw new Error(`neutral tsc build failed:\n${tailOutput(b.stdout)}\n${tailOutput(b.stderr)}`);
  if (!fs.existsSync(NEUTRAL_DIST_SERVER))
    throw new Error(`build exited 0 but dist entry missing: ${NEUTRAL_DIST_SERVER}`);
  log('dist built with local tsc');

  // 4. Stamp. Version match is what neutralDaemonReady() checks.
  fs.writeFileSync(
    NEUTRAL_VERSION_FILE,
    JSON.stringify({ version: expected, syncedAt: new Date().toISOString(), node: process.version }, null, 2) +
      '\n'
  );
  log(`neutral daemon ${expected} ready`);
  return { synced: true, state: 'ready', expected, found: expected };
}

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
    const cfg = JSON.parse(stripJsonComments(fs.readFileSync(PLUGIN_JSON, 'utf8')));
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
 * A marketplace clone ships source but NO node_modules or dist/ — Claude
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

/** GET /health with a short timeout. Returns the parsed body or null on failure.
 *  probe=true → ask the daemon to verify the provider is actually reachable. */
export async function getHealth(timeoutMs = 1000, { probe = false } = {}) {
  try {
    const qs = probe ? '?probe=true' : '';
    const res = await fetch(`${getBaseURL()}/health${qs}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Should we run in dev mode (tsx on source) instead of compiled dist/?
 *
 * Pinned, not auto-detected: the installed plugin ships a tracked
 * tsconfig.json, so detecting dev from its presence made every clean
 * install behave as dev — skipping neutral/dist straight into a network
 * fetch at hook time. Unset means production. Repo developers working
 * from source export CONTEXTUS_DEV=1 in their shell.
 *   CONTEXTUS_DEV=1  → dev mode (tsx on source)
 *   CONTEXTUS_DEV=0 (or unset) → production (neutral dist, else repo dist)
 */
export function isDevMode() {
  const env = process.env.CONTEXTUS_DEV;
  if (env === '1' || env === 'true') return true;
  return false;
}

/**
 * Resolve how to launch a daemon process. In dev mode, always uses tsx on the
 * TypeScript source (changes take effect without `tsc`). In production, uses
 * the compiled dist/ JS (neutral home first, repo dist second). Returns
 * { cmd, args } for spawn(). `extraArgs` are appended after the entry
 * file — used for CLI scripts (e.g. mine-transcripts.ts's `--project <cwd>`),
 * unused (empty) for the daemon/eval-worker's own launches.
 *
 * No npx fallback, ever: a network fetch at hook time is the hole the
 * neutral mapping closed. When nothing runnable exists, this throws with an
 * actionable message — hook callers catch it into their normal down-path
 * (fail open), setup surfaces it loudly (fail closed).
 */
function resolveLaunch(jsPath, tsPath, extraArgs = []) {
  // Neutral ready + non-dev → run the setup-owned build (host-shared). Covers
  // the daemon AND the eval worker (both live in the neutral dist). Never a
  // second daemon: callers check /health (reuse) before they ever spawn.
  if (!isDevMode() && neutralDaemonReady()) {
    if (jsPath === DAEMON_JS) return { cmd: process.execPath, args: [NEUTRAL_DIST_SERVER, ...extraArgs] };
    if (jsPath === EVAL_WORKER_JS)
      return { cmd: process.execPath, args: [NEUTRAL_DIST_WORKER, ...extraArgs] };
  }
  if (!isDevMode() && fs.existsSync(jsPath)) {
    return { cmd: process.execPath, args: [jsPath, ...extraArgs] }; // node dist/.../X.js
  }
  // Dev mode (CONTEXTUS_DEV=1): run .ts via the repo-local tsx only.
  if (isDevMode() && fs.existsSync(TSX_BIN)) {
    return { cmd: TSX_BIN, args: [tsPath, ...extraArgs] };
  }
  throw new Error(
    `no runnable daemon build (neutral dist missing, repo dist missing, no repo tsx) — run setup to sync and build the neutral home: node scripts/sync-neutral-daemon.js`
  );
}

/**
 * Spawn a detached process (daemon, eval-worker, or a one-shot CLI script like
 * mine-transcripts) that outlives the hook.
 *
 * `logFile`, when given, redirects the child's stdout/stderr to that file
 * (append mode) instead of discarding them. The daemon/eval-worker's own
 * spawns don't pass this — they already have structured logging via
 * lib/logger.js, so a second raw-output file would be redundant. mine-
 * transcripts.ts has no such logging and was previously fully silent on
 * every failure mode (independent review of #40, item #8) — combined with
 * #1/#7, a daemon-down run or a broken install path failed with zero trace
 * anywhere. The fd is duplicated into the child at spawn time (standard
 * Node behavior), so closing our copy right after spawning doesn't affect
 * the child's writes — it keeps writing after this (short-lived) hook exits.
 */
export function spawnDetached(jsPath, tsPath, extraArgs = [], { logFile } = {}) {
  const { cmd, args } = resolveLaunch(jsPath, tsPath, extraArgs);
  // Packaged launches load native deps from ${CLAUDE_PLUGIN_DATA}/node_modules via
  // NODE_PATH (the repo has none). In dev this resolves to the repo's own
  // node_modules — a harmless explicit no-op (Node already searches it).
  const env = { ...process.env, NODE_PATH: depsNodeModules() };

  let stdio = 'ignore';
  let fd = null;
  if (logFile) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fd = fs.openSync(logFile, 'a');
      stdio = ['ignore', fd, fd];
    } catch {
      // Best-effort — never let logging setup block the actual spawn.
      stdio = 'ignore';
      fd = null;
    }
  }

  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio,
    env,
  });
  if (fd !== null) fs.closeSync(fd); // child already has its own duplicated fd
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
  // Fixture isolation lock (2026-10-27): a pinned dead URL must stay dead.
  // Fixtures set CONTEXTUS_NO_SPAWN=1 alongside CONTEXTUS_DAEMON_URL so a
  // down check can never escalate into launching a second daemon next to a
  // healthy shared one. Production never sets this — hooks there must keep
  // the self-heal-by-spawning behavior. Returns false (not already running);
  // callers take their normal down-path against the pinned URL.
  if (process.env.CONTEXTUS_NO_SPAWN) return false;
  const health = await getHealth(1000);
  if (health) {
    // Reuse wins over code path: a healthy daemon serves regardless of where
    // its code lives. Version drift is warned, never acted on here.
    noteDaemonVersion(health);
    return true;
  }

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
  try {
    spawnDaemon();
  } catch {
    // No runnable build (resolveLaunch threw): stay on the down-path.
    // Hooks degrade to nudge/fail-open; setup surfaces this loudly itself.
  }
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
 * Does the project AGENTS.md already carry the contextus stanza? Muse-host
 * counterpart of hasContextusStanza (Muse uses AGENTS.md, not CLAUDE.md).
 * Setup owns the file; hooks only read. A missing file counts as "no stanza".
 */
export function hasAgentsStanza(cwd) {
  const file = path.join(cwd || process.cwd(), 'AGENTS.md');
  try {
    return fs.readFileSync(file, 'utf8').includes(STANZA_START);
  } catch {
    return false; // no AGENTS.md → no stanza
  }
}

/**
 * Setup-completion stamp. Written by /contextus-setup on success, read by the
 * Muse SessionStart hook to tell "setup ran, silence is expected" apart from
 * "setup never ran". Lives at `<project>/.claude/setup.json` (NOT inside
 * `.claude/context/`, which gets embedded). Machine-local state in effect,
 * but safe if committed: a stamped project with a dead daemon still nudges,
 * because the hook checks /health independently of the stamp.
 */
export function setupStampPath(cwd) {
  return path.join(cwd || process.cwd(), '.claude', 'setup.json');
}

/** The parsed stamp object, or null when setup has not completed here. */
export function readSetupStamp(cwd) {
  try {
    const raw = fs.readFileSync(setupStampPath(cwd), 'utf8');
    const stamp = JSON.parse(raw);
    if (stamp && typeof stamp === 'object' && stamp.version === 1) return stamp;
    return null;
  } catch {
    return null; // missing/unparseable → not set up
  }
}

/** Record a completed setup run. Never throws (setup reports, never crashes). */
export function writeSetupStamp(cwd, info = {}) {
  try {
    const dir = path.dirname(setupStampPath(cwd));
    fs.mkdirSync(dir, { recursive: true });
    const stamp = {
      version: 1,
      completedAt: new Date().toISOString(),
      host: info.host || 'claude',
    };
    fs.writeFileSync(setupStampPath(cwd), JSON.stringify(stamp, null, 2) + '\n');
    return stamp;
  } catch {
    return null;
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
    const res = await fetch(`${getBaseURL()}/reconcile`, {
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
    const res = await fetch(`${getBaseURL()}/reconcile`, {
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

/* ── Transcript mining trigger (GH issue #39) ────────────────────────────────
 * Unlike /reconcile, mine-transcripts.ts has no daemon endpoint — it's a
 * standalone process that calls the LLM (Haiku/Bedrock) directly and writes
 * via /capture. "Fire it in the background" here means spawning a real
 * detached OS process (spawnDetached), not an HTTP call the daemon completes
 * asynchronously on its own.
 *
 * Kept as plain JS (mirrors lib/transcript/parser.ts's projectSlug()/
 * discoverSessions() logic rather than importing it — same reasoning as
 * getBaseURL() above: hooks run with no build step and can't import .ts).
 * Both implementations must stay in sync if the slug scheme ever changes.
 */
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const TRANSCRIPT_STATE_PATH = path.join(os.homedir(), '.contextus', 'transcript-state.json');

function transcriptSlugFor(cwd) {
  return path.resolve(cwd).replace(/[/.]/g, '-');
}

function readTranscriptWatermark(cwd) {
  try {
    const raw = fs.readFileSync(TRANSCRIPT_STATE_PATH, 'utf-8');
    const state = JSON.parse(raw);
    const proj = state.projects?.[transcriptSlugFor(cwd)];
    if (!proj?.lastScanned) return null;
    const d = new Date(proj.lastScanned);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null; // no state file yet = never scanned
  }
}

/** Count session files modified after `since`. Always called with a concrete
 * Date (never null) — see checkTranscriptMining for why. */
function countPendingSessions(cwd, since) {
  const dir = path.join(PROJECTS_DIR, transcriptSlugFor(cwd));
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    return files.filter((f) => fs.statSync(path.join(dir, f)).mtime > since).length;
  } catch {
    return 0; // no session-log dir for this project — nothing to mine
  }
}

/**
 * Decide whether a background transcript-mining scan is due this session, and
 * how many sessions are pending (for the systemMessage). Cheap — only reads
 * the watermark file and lists a directory, no LLM/daemon calls itself.
 *
 * `transcriptMiningConfig` is `{enabled, intervalHours}` from the project's
 * properly MERGED config (loadProjectConfig) — piggybacked onto /reconcile's
 * check-mode response (daemon/server.ts) rather than read raw here, so a
 * project's `.claude/contextus.jsonc` opt-in/opt-out is actually honored
 * (same bug class as /notify's determineSource() pre-#22 fix — a plain-JS
 * hook with no build step can't import lib/config.ts's loadProjectConfig
 * directly, and hand-parsing the raw plugin manifest here would repeat that
 * exact mistake). Defaults to disabled if the caller can't supply it (daemon
 * unreachable) — never mine without a config value confirming opt-in.
 */
export function checkTranscriptMining(cwd, transcriptMiningConfig) {
  if (!transcriptMiningConfig?.enabled) return { due: false, pending: 0 };
  // Validate, don't just `?? 24` — `??` only catches null/undefined, not a
  // non-numeric value (e.g. a typo'd "daily" in a hand-edited
  // .claude/contextus.jsonc). `hours * 3600000` on a non-numeric string is
  // NaN, and `elapsed < NaN` is always false, silently disabling the
  // throttle entirely — mining would then fire on every SessionStart instead
  // of respecting any interval. Falls back to the safe default (24h) for
  // anything that isn't a finite, non-negative number. 0 is honored as a
  // deliberate "always due" choice.
  const rawHours = transcriptMiningConfig.intervalHours;
  const hours = typeof rawHours === 'number' && Number.isFinite(rawHours) && rawHours >= 0
    ? rawHours
    : 24;
  const intervalMs = hours * 60 * 60 * 1000;
  const watermark = readTranscriptWatermark(cwd);
  if (watermark && Date.now() - watermark.getTime() < intervalMs) {
    return { due: false, pending: 0 };
  }
  // The "pending" count must match what mine-transcripts.ts's mineProject()
  // will ACTUALLY scan, or the reported number lies and the trigger can loop
  // pointlessly (independent review of #40, #5): mineProject's own
  // parseSince() falls back to a hardcoded 24h lookback when there's no
  // watermark and no --since override (which the automatic SessionStart
  // trigger never passes) — NOT to `intervalHours` (a separate setting: the
  // cadence between recurring checks, not the lookback window for a
  // never-scanned project's first scan). Mirror that exact 24h constant here
  // rather than counting every session file ever, which used to make a
  // long-quiet project with old-but-not-recent sessions report `due: true`
  // and spawn a scan whose narrower 24h window then found nothing — forever.
  const effectiveSince = watermark ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pending = countPendingSessions(cwd, effectiveSince);
  return { due: pending > 0, pending };
}

/** Spawn scripts/mine-transcripts.ts detached, scoped to this project only —
 * never --all from a per-project hook (a workspace with many projects would
 * otherwise re-scan every one of them on every project's session start). */
const TRANSCRIPT_MINING_LOG = path.join(os.homedir(), '.contextus', 'logs', 'transcript-mining.log');

export function fireTranscriptMining(cwd) {
  spawnDetached(MINE_TRANSCRIPTS_JS, MINE_TRANSCRIPTS_TS, ['--project', cwd], {
    logFile: TRANSCRIPT_MINING_LOG
  });
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

/**
 * Stamp ~/.contextus/version.json with the given version. Mirrors lib/version.ts's
 * writeVersionState (duplicated here, not imported — this file is plain JS, see
 * header comment: hooks can't import .ts libs without a build step).
 *
 * Called after a non-breaking "updated to X" notice so the message fires once,
 * right after the real version bump, instead of repeating every session (the
 * breaking-change path already gets stamped by /contextus-upgrade Step 4).
 */
export function stampVersion(version) {
  try {
    const versionPath = path.join(os.homedir(), '.contextus', 'version.json');
    fs.mkdirSync(path.dirname(versionPath), { recursive: true });
    fs.writeFileSync(
      versionPath,
      JSON.stringify({ version, migratedAt: new Date().toISOString() }, null, 2) + '\n'
    );
  } catch {
    // Best-effort — if this fails, the notice just repeats next session. Non-fatal.
  }
}

/**
 * Lightweight upgrade check — compares data schema version against installed code.
 * Returns { needed, dataVersion, installedVersion, hasBreakingChanges } or null on error.
 * Pure filesystem reads (~1ms), no network, safe to call on every session start.
 *
 * hasBreakingChanges=true means MIGRATIONS.md has an entry between dataVersion and
 * installedVersion, which requires running /contextus-upgrade.
 */
export function checkUpgradeNeeded() {
  try {
    const versionPath = path.join(os.homedir(), '.contextus', 'version.json');
    const pkgPath = path.join(REPO_ROOT, 'package.json');

    let dataVersion = '0.0.0';
    try {
      const raw = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
      dataVersion = raw.version ?? '0.0.0';
    } catch {
      // No version.json = fresh install, version is 0.0.0
    }

    let installedVersion = '0.0.0';
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      installedVersion = pkg.version ?? '0.0.0';
    } catch {
      return null;
    }

    const pa = dataVersion.split('.').map(Number);
    const pb = installedVersion.split('.').map(Number);
    let needed = false;
    for (let i = 0; i < 3; i++) {
      if ((pa[i] ?? 0) < (pb[i] ?? 0)) { needed = true; break; }
      if ((pa[i] ?? 0) > (pb[i] ?? 0)) break;
    }

    // Check if MIGRATIONS.md has entries between dataVersion and installedVersion
    let hasBreakingChanges = false;
    if (needed) {
      try {
        const migrationsPath = path.join(REPO_ROOT, 'migrations', 'MIGRATIONS.md');
        const migrations = fs.readFileSync(migrationsPath, 'utf8');
        // Extract all version headers: ## X.Y.Z — Title
        const versionPattern = /^## (\d+\.\d+\.\d+)/gm;
        let match;
        while ((match = versionPattern.exec(migrations)) !== null) {
          const migrationVersion = match[1];
          const mv = migrationVersion.split('.').map(Number);
          // Is this migration version between dataVersion and installedVersion?
          let afterData = false;
          let beforeOrEqualInstalled = false;
          for (let i = 0; i < 3; i++) {
            if ((mv[i] ?? 0) > (pa[i] ?? 0)) { afterData = true; break; }
            if ((mv[i] ?? 0) < (pa[i] ?? 0)) break;
          }
          for (let i = 0; i < 3; i++) {
            if ((mv[i] ?? 0) < (pb[i] ?? 0)) { beforeOrEqualInstalled = true; break; }
            if ((mv[i] ?? 0) > (pb[i] ?? 0)) break;
            if (i === 2 && (mv[i] ?? 0) === (pb[i] ?? 0)) beforeOrEqualInstalled = true;
          }
          if (afterData && beforeOrEqualInstalled) {
            hasBreakingChanges = true;
            break;
          }
        }
      } catch {
        // Can't read MIGRATIONS.md — assume no breaking changes (non-blocking)
      }
    }

    return { needed, dataVersion, installedVersion, hasBreakingChanges };
  } catch {
    return null;
  }
}
