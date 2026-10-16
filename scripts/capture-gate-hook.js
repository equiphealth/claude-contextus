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
 *     not an infinite loop. On that retry invocation it logs the outcome —
 *     "captured after nudge" or "nudged but it did not" — as the miss-rate
 *     metric this prototype exists to surface (see the decision doc).
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
import { projectHash } from './lib/project-hash.js';
import {
  extractLastTurn,
  lastCaptureTimestamp,
  shouldBlockForCapture,
  extractCommitSummary,
  hasExplicitSkip,
  hasCaptureFooter,
  logCaptureNudge,
} from './lib/capture-gate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_JSONC = path.resolve(__dirname, '..', 'plugin.jsonc');
const PLUGIN_JSON_FALLBACK = path.resolve(__dirname, '..', 'plugin.json');
const PLUGIN_JSON = fs.existsSync(PLUGIN_JSONC) ? PLUGIN_JSONC : PLUGIN_JSON_FALLBACK;
const CAPTURES_LOG = path.resolve(os.homedir(), '.contextus', 'captures.log');
// One-shot marker written when we block, read (and deleted) on the
// stop_hook_active retry — see the comment at that call site for why we
// can't just re-derive the commit from the transcript on retry. Scoped per
// project (same reason as captureLogTag in daemon/server.ts) so two
// concurrent sessions blocking around the same moment in different projects
// can't clobber each other's pending marker.
function pendingMarkerPath(project) {
  return path.resolve(os.homedir(), '.contextus', `.capture-gate-pending-${project}.json`);
}

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

function projectLabel(cwd) {
  return projectHash(cwd || process.cwd());
}

/** Best-effort — a failure here must never block the Stop decision itself. */
function writePendingMarker(project, data) {
  try {
    const markerPath = pendingMarkerPath(project);
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, JSON.stringify(data));
  } catch {
    // best-effort
  }
}

function readPendingMarker(project) {
  try {
    return JSON.parse(fs.readFileSync(pendingMarkerPath(project), 'utf8'));
  } catch {
    return null;
  }
}

function clearPendingMarker(project) {
  try {
    fs.unlinkSync(pendingMarkerPath(project));
  } catch {
    // best-effort
  }
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return; // malformed stdin — never block on a parse error
  }

  if (!stopGateEnabled(payload.cwd)) return;
  if (!payload.transcript_path) return;

  const project = projectLabel(payload.cwd);
  const { toolUses, responseText, turnStartTs } = extractLastTurn(payload.transcript_path);

  // Loop guard: Claude Code sets stop_hook_active true when re-invoking Stop
  // hooks after a previous block. Never block twice — but this is exactly the
  // moment to check whether the nudge worked and log the outcome.
  if (payload.stop_hook_active) {
    const pending = readPendingMarker(project);
    if (!pending) return; // nothing to report — we never actually blocked this cycle
    clearPendingMarker(project);
    // Deliberately NOT shouldBlockForCapture() here: its first gate is
    // hasGitCommit(toolUses), and toolUses on THIS invocation is scoped to
    // whatever happened after our own injected block reason got written back
    // into the transcript — the original `git commit` tool_use is out of
    // view (same bug class as extractLastTurn's tool_result-is-type-'user'
    // fix, one layer up: see gotcha-transcript-tool-result-is-also-type-user.md).
    // hasGitCommit would always be false here regardless of outcome, which
    // would misreport "resolved" as "missed" unconditionally. We already
    // KNOW a commit happened — that's why a pending marker exists — so just
    // check directly whether it's been resolved since: an explicit skip, a
    // capture footer, or a captures.log entry at/after the ORIGINAL turn
    // start (saved in the marker, not re-derived from this invocation).
    const lastCaptureTs = lastCaptureTimestamp(CAPTURES_LOG, project);
    const resolved =
      hasExplicitSkip(responseText) ||
      hasCaptureFooter(responseText) ||
      (pending.turnStartTs &&
        lastCaptureTs &&
        Date.parse(lastCaptureTs) >= Date.parse(pending.turnStartTs));
    logCaptureNudge({
      outcome: resolved ? 'captured_after_nudge' : 'missed',
      project,
      commitSummary: pending.commitSummary,
    });
    return;
  }

  const lastCaptureTs = lastCaptureTimestamp(CAPTURES_LOG, project);
  const stillMissing = shouldBlockForCapture({ toolUses, responseText, turnStartTs, lastCaptureTs });
  if (stillMissing) {
    const commitSummary = extractCommitSummary(toolUses) || 'recent commit';
    writePendingMarker(project, { commitSummary, turnStartTs });
    logCaptureNudge({ outcome: 'nudged', project, commitSummary });
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
