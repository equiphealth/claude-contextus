#!/usr/bin/env node
/**
 * Stop hook — capture-enforcement gate (prototype).
 *
 * See .claude/context/decisions/decision-capture-enforcement-needs-a-stop-hook-not-wording.md
 * for the design rationale. Short version: the UserPromptSubmit capture nudge is a
 * soft reminder that a live task always wins against — nothing stops a turn from
 * ending without a capture call. This hook adds the missing teeth for the one
 * cheaply-detectable case: a `git commit` ran this turn with no capture logged
 * since the turn began.
 *
 * Deliberately conservative:
 *   - Off by default (config.contextCapture.stopGate must be true) — this is a
 *     prototype, opt in per-project to test it before it becomes a default.
 *   - Only fires on a `git commit` Bash call, not on Edit/Write in general —
 *     the noisiest, most false-positive-prone heuristic is not this one.
 *   - Honors Claude Code's `stop_hook_active` loop guard: if this hook already
 *     blocked once for this stop cycle, it does not block again. One nudge,
 *     not an infinite loop.
 *   - Respects an explicit "Context: capture-skip: <reason>" acknowledgment —
 *     Claude can say "nothing durable here" and proceed.
 *
 * Plain ESM JS (no build step), same shape as stop-evaluation.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { stripJsonComments } from './lib/parse-jsonc.js';
import {
  extractLastTurn,
  lastCaptureTimestamp,
  shouldBlockForCapture,
} from './lib/capture-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_JSONC = path.resolve(__dirname, '..', 'plugin.jsonc');
const PLUGIN_JSON_FALLBACK = path.resolve(__dirname, '..', 'plugin.json');
const PLUGIN_JSON = fs.existsSync(PLUGIN_JSONC) ? PLUGIN_JSONC : PLUGIN_JSON_FALLBACK;
const CAPTURES_LOG = path.resolve(os.homedir(), '.contextus', 'captures.log');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

/** Read contextCapture.stopGate with precedence: project > plugin. Default: false. */
function stopGateEnabled(cwd) {
  let enabled = false;
  try {
    const text = fs.readFileSync(PLUGIN_JSON, 'utf8');
    const cfg = JSON.parse(stripJsonComments(text));
    if (typeof cfg?.config?.contextCapture?.stopGate === 'boolean') {
      enabled = cfg.config.contextCapture.stopGate;
    }
  } catch {}
  try {
    const projectConfig = path.resolve(cwd || process.cwd(), '.claude', 'contextus.jsonc');
    const text = fs.readFileSync(projectConfig, 'utf8');
    const cfg = JSON.parse(stripJsonComments(text));
    if (typeof cfg?.contextCapture?.stopGate === 'boolean') {
      enabled = cfg.contextCapture.stopGate;
    }
  } catch {}
  return enabled;
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin — never block on a parse error
  }

  // Loop guard: Claude Code sets this true when re-invoking Stop hooks after a
  // previous block. Nudge once per cycle, never trap the session.
  if (payload.stop_hook_active) return;

  if (!stopGateEnabled(payload.cwd)) return;

  if (!payload.transcript_path) return;

  const { toolUses, responseText, turnStartTs } = extractLastTurn(payload.transcript_path);
  const lastCaptureTs = lastCaptureTimestamp(CAPTURES_LOG);

  if (shouldBlockForCapture({ toolUses, responseText, turnStartTs, lastCaptureTs })) {
    process.stdout.write(
      JSON.stringify({
        decision: 'block',
        reason:
          "You ran `git commit` this turn but no context capture has been logged since. " +
          'If this commit surfaced a reusable pattern, decision, or gotcha, call the ' +
          "daemon's /capture endpoint now. If genuinely nothing durable came out of it, " +
          'end your reply with "Context: capture-skip: <why>" and proceed.',
      })
    );
  }
}

main();
