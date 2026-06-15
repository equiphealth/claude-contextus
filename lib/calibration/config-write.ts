/**
 * Config-write plumbing — the shared --diff/--apply path for /context-calibrate.
 *
 * Both calibration signals (cold-start floor-replay and usage-eval refinement —
 * calibration-two-signals memory) ultimately want to write a small set of
 * retrieval knobs into plugin.json. Rather than each path reimplement "show the
 * diff" / "write the file", they share this: compute a proposed change set, render
 * it, and (on apply) write it back preserving the rest of the file.
 *
 * Targets the deployed plugin.json `config.retrieval.*` (what the daemon reads via
 * lib/config.ts). The path resolution is duplicated from config.ts on purpose:
 * this is the WRITE side and shouldn't import the read-cache.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Repo root = two levels up from lib/calibration/. */
const PLUGIN_JSON = path.resolve(__dirname, '..', '..', 'plugin.json');

/** A single proposed config change (dotted path under config.*). */
export interface ConfigChange {
  /** dotted key under plugin.json `config`, e.g. 'retrieval.injectionFloor' */
  key: string;
  current: unknown;
  proposed: unknown;
}

/** Read a config file's root object, or {} if it's missing/unparseable. */
function readRaw(pluginPath: string): Record<string, any> {
  try {
    if (!fs.existsSync(pluginPath)) return {};
    return JSON.parse(fs.readFileSync(pluginPath, 'utf8')) as Record<string, any>;
  } catch {
    return {};
  }
}

/** Read the current value at a dotted path under a config file's `config`. */
export function readConfigValue(dotted: string, pluginPath = PLUGIN_JSON): unknown {
  const raw = readRaw(pluginPath);
  let node: unknown = raw.config ?? {};
  for (const seg of dotted.split('.')) {
    if (node && typeof node === 'object' && seg in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return node;
}

/** Build a change set from {dottedKey: proposedValue}, reading current values. */
export function buildChanges(
  proposals: Record<string, unknown>,
  pluginPath = PLUGIN_JSON
): ConfigChange[] {
  return Object.entries(proposals).map(([key, proposed]) => ({
    key,
    current: readConfigValue(key, pluginPath),
    proposed,
  }));
}

/** Render a change set as a human-readable diff (no I/O). */
export function renderDiff(changes: ConfigChange[]): string {
  if (changes.length === 0) return '  (no changes — config already matches)';
  return changes
    .filter((c) => c.current !== c.proposed)
    .map(
      (c) =>
        `  config.${c.key}\n    - ${JSON.stringify(c.current)}\n    + ${JSON.stringify(c.proposed)}`
    )
    .join('\n');
}

/** True if any change actually differs from the current value. */
export function hasRealChanges(changes: ConfigChange[]): boolean {
  return changes.some((c) => c.current !== c.proposed);
}

/**
 * Apply a change set to plugin.json, writing each dotted path under `config`.
 * Preserves the rest of the file (including the `_*_note` annotation keys).
 * Returns the number of values actually changed.
 */
export function applyChanges(changes: ConfigChange[], pluginPath = PLUGIN_JSON): number {
  const raw = readRaw(pluginPath); // {} if the target doesn't exist yet (project-local)
  raw.config = raw.config ?? {};
  let written = 0;
  for (const c of changes) {
    if (c.current === c.proposed) continue;
    const segs = c.key.split('.');
    let node: Record<string, unknown> = raw.config;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      if (typeof node[seg] !== 'object' || node[seg] === null) node[seg] = {};
      node = node[seg] as Record<string, unknown>;
    }
    node[segs[segs.length - 1]] = c.proposed;
    written++;
  }
  if (written > 0) {
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true }); // project-local dir may not exist
    fs.writeFileSync(pluginPath, JSON.stringify(raw, null, 2) + '\n');
  }
  return written;
}
