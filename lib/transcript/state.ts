/**
 * Transcript mining watermark state — tracks what's been scanned so
 * recurring runs only process the delta.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../config.js';

const STATE_FILE = expandHome('~/.contextus/transcript-state.json');

export interface ProjectScanState {
  lastScanned: string; // ISO timestamp
  lastSessionFile: string;
  patternsExtracted: number;
  sessionsProcessed: number;
}

export interface TranscriptState {
  version: number;
  projects: Record<string, ProjectScanState>;
}

const EMPTY_STATE: TranscriptState = { version: 1, projects: {} };

export function readState(): TranscriptState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    return JSON.parse(raw) as TranscriptState;
  } catch {
    return { ...EMPTY_STATE, projects: {} };
  }
}

export function writeState(state: TranscriptState): void {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function getProjectState(
  state: TranscriptState,
  slug: string
): ProjectScanState | undefined {
  return state.projects[slug];
}

export function updateProjectState(
  state: TranscriptState,
  slug: string,
  update: Partial<ProjectScanState>
): TranscriptState {
  const existing = state.projects[slug] ?? {
    lastScanned: '',
    lastSessionFile: '',
    patternsExtracted: 0,
    sessionsProcessed: 0
  };
  return {
    ...state,
    projects: {
      ...state.projects,
      [slug]: { ...existing, ...update }
    }
  };
}

/** Get the watermark date for a project (null = never scanned). */
export function getWatermark(slug: string): Date | null {
  const state = readState();
  const proj = state.projects[slug];
  if (!proj?.lastScanned) return null;
  const d = new Date(proj.lastScanned);
  return isNaN(d.getTime()) ? null : d;
}

/*
 * Per-project concurrent-run lock (independent review of PR #40, item #4,
 * GH issue #39). The SessionStart trigger fires-and-forgets — the watermark
 * isn't updated until the spawned process finishes, so two Claude Code
 * sessions opened in the same project within the mining window both used to
 * see the trigger's `due: true` and both spawn a full scan of the same
 * backlog: doubled LLM cost, duplicate `/capture` writes (neither run has
 * written anything yet for the other's dedup check to find).
 *
 * The lock lives entirely on the SPAWNED PROCESS side (mineProject, below) —
 * the SessionStart hook still fires freely without checking anything; a
 * second concurrent run just detects the lock immediately and exits having
 * done no real work, which alone prevents the double-cost problem. No need
 * to duplicate lock-checking logic in the plain-JS hook (unlike getDaemonURL/
 * projectSlug, which DO need matching implementations on both sides because
 * the hook makes its OWN routing decision — this lock doesn't; it's purely
 * "don't do the work twice", enforced by whichever process actually runs it).
 */
function lockPath(slug: string): string {
  return path.join(expandHome('~/.contextus/runtime'), `transcript-mining-${slug}.lock`);
}

/** Best-effort liveness check — false on any error (including ESRCH, i.e.
 * "no such process", the expected case for a stale lock). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to acquire the mining lock for a project. Returns true if acquired (the
 * caller should proceed, and MUST call releaseMiningLock when done, success
 * or failure). Returns false if another live process already holds it — the
 * caller should skip this run entirely, doing no LLM/capture work.
 *
 * A lock whose PID is no longer alive (a prior run crashed, or was killed,
 * without reaching its cleanup) is treated as stale and overwritten — this
 * is best-effort, not a hard distributed-lock guarantee (there's a narrow
 * TOCTOU window between the exists-check and the write), which is an
 * acceptable tradeoff for "avoid the common case of two sessions racing",
 * not a correctness-critical resource.
 */
export function acquireMiningLock(slug: string): boolean {
  const p = lockPath(slug);
  try {
    if (fs.existsSync(p)) {
      const existingPid = parseInt(fs.readFileSync(p, 'utf-8').trim(), 10);
      if (!isNaN(existingPid) && isPidAlive(existingPid)) {
        return false; // another live process is already mining this project
      }
      // Stale lock (process no longer alive) — fall through and overwrite.
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(process.pid));
    return true;
  } catch {
    // Best-effort — a lock-mechanism failure shouldn't block mining entirely.
    return true;
  }
}

/** Release a previously acquired lock. Only removes it if this process still
 * owns it (paranoia against removing a different process's lock in the
 * unlikely event of PID reuse racing this exact moment). */
export function releaseMiningLock(slug: string): void {
  const p = lockPath(slug);
  try {
    if (!fs.existsSync(p)) return;
    const existingPid = parseInt(fs.readFileSync(p, 'utf-8').trim(), 10);
    if (existingPid === process.pid) fs.unlinkSync(p);
  } catch {
    /* best-effort */
  }
}
