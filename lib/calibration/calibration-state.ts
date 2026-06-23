/**
 * Calibration runtime state — the MUTABLE half of calibration config.
 *
 * Static defaults (whether eval is enabled by default, target sample count, which
 * model judges) live in plugin.json. But calibration is a stateful, bounded
 * campaign: "evaluate the next 100 prompts, then stop." That live counter + the
 * enabled/disabled flip must persist across daemon restarts and must NOT mutate
 * the checked-in plugin.json. So runtime state is a separate file under
 * ~/.contextus/ (file-based session state, per the project's file-everything
 * preference) that /context-calibrate --start writes and the eval worker updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome, loadConfig } from '../config.js';
import type { EvalModelConfig } from './eval-model.js';
import { DEFAULT_EVAL_MODEL } from './eval-model.js';

const STATE_PATH = expandHome('~/.contextus/calibration-state.json');

export interface CalibrationState {
  /** is usage-evaluation currently active? */
  evaluateUsage: boolean;
  /** how many evaluated retrievals to collect before auto-disabling */
  targetSamples: number;
  /** evaluations logged so far this campaign */
  sampleCount: number;
  /** ISO when --start ran, or null */
  startedAt: string | null;
  /** ISO when the target was hit and eval auto-disabled, or null */
  completedAt: string | null;
  /** which model grades usage */
  model: EvalModelConfig;
}

/** Defaults sourced from plugin.json `config.calibration`, falling back to code. */
function defaults(): CalibrationState {
  const cfg = loadConfig();
  const c = cfg.calibration;
  const model: EvalModelConfig = c
    ? {
        provider: c.provider,
        model: c.model,
        endpoint: cfg.providers.ollama.endpoint,
        region: cfg.providers.bedrock.region
      }
    : DEFAULT_EVAL_MODEL;
  return {
    evaluateUsage: false,
    targetSamples: c?.targetSamples ?? 100,
    sampleCount: 0,
    startedAt: null,
    completedAt: null,
    model
  };
}

/** Read current state, materializing defaults on first access. */
export function readState(): CalibrationState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')) as Partial<CalibrationState>;
    return { ...defaults(), ...parsed };
  } catch {
    return defaults();
  }
}

/** Persist state (creates ~/.contextus/ if needed). Best-effort dir creation. */
export function writeState(state: CalibrationState): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

/** Begin a calibration campaign (/context-calibrate --start). */
export function startCalibration(
  opts: { targetSamples?: number; model?: EvalModelConfig } = {}
): CalibrationState {
  const base = defaults();
  const state: CalibrationState = {
    ...base,
    evaluateUsage: true,
    targetSamples: opts.targetSamples ?? base.targetSamples,
    model: opts.model ?? base.model,
    sampleCount: 0,
    startedAt: new Date().toISOString(),
    completedAt: null
  };
  writeState(state);
  return state;
}

/**
 * Record one completed evaluation; auto-disable when the target is reached.
 * Returns the updated state so the caller can log completion.
 */
export function recordSample(): CalibrationState {
  const state = readState();
  state.sampleCount += 1;
  if (state.sampleCount >= state.targetSamples) {
    state.evaluateUsage = false;
    state.completedAt = new Date().toISOString();
  }
  writeState(state);
  return state;
}
