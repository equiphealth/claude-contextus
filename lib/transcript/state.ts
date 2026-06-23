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
