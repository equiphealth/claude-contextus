/**
 * Session state — the bridge between /query (injection) and the Stop hook (eval).
 *
 * The eval worker needs to know WHAT was injected for the prompt it's grading,
 * but injection happens in the daemon and grading happens in a separate Stop-hook
 * process. So /query records the last injection per project here, and the Stop
 * hook reads it back to build the eval job (evaluation-architecture memory).
 *
 * File-based, per CLAUDE.md core principle 7 (~/.contextus/.session-state.json).
 * Keyed by project, last-write-wins: only the most recent prompt per project is
 * retained, which is all the Stop hook needs (it fires once per response).
 */

import fs from 'fs';
import path from 'path';
import { expandHome } from './config.js';
import type { InjectedPattern } from './eval-calibration.js';

const STATE_PATH = expandHome('~/.contextus/.session-state.json');

/** The injection recorded for a project's most recent injected prompt. */
export interface LastInjection {
  promptHash: string;
  patterns: InjectedPattern[];
  timestamp: string;
}

type StateFile = Record<string, LastInjection>;

function readAll(): StateFile {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as StateFile;
  } catch {
    return {};
  }
}

/** Record what /query injected for a project (best-effort, off the hot path). */
export function recordLastInjection(project: string, injection: LastInjection): void {
  try {
    const all = readAll();
    all[project] = injection;
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(all, null, 2));
  } catch {
    /* session state is a calibration convenience; never break the query path */
  }
}

/** Read the last injection for a project (Stop hook), or null if none. */
export function readLastInjection(project: string): LastInjection | null {
  return readAll()[project] ?? null;
}
