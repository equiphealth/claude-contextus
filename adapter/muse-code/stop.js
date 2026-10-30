#!/usr/bin/env node
/**
 * Muse Stop: usage-signal logging only (Phase 1).
 *
 * Mirrors scripts/stop-evaluation.js without transcript-file reads: Muse hands
 * hooks `last_assistant_message` directly, so there is no transcript path to
 * parse and no retry loop. Parses the `Context: used:` footer from the message,
 * logs the same `usage_signal` shape, and enqueues calibration the same way.
 * Emits nothing on the happy path; no additionalContext on Stop, ever.
 * The capture gate is NOT ported in Phase 1 (it can block; needs its own
 * live check first). Always exit 0 — logging must never block turn end.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectHash } from '../../scripts/lib/project-hash.js';
import { stripJsonComments } from '../../scripts/lib/parse-jsonc.js';
import { emitEmpty } from '../shared/emit.js';

const CONTEXTUS = path.join(os.homedir(), '.contextus');
const USAGE_PATH = path.join(CONTEXTUS, 'logs', 'usage.jsonl');
const DAEMON_LOG_PATH = path.join(CONTEXTUS, 'logs', 'daemon.log');
const SESSION_STATE = path.join(CONTEXTUS, '.session-state.json');
const EVAL_QUEUE = path.join(CONTEXTUS, '.eval-queue.jsonl');
const CALIBRATION_STATE = path.join(CONTEXTUS, 'calibration-state.json');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readJsonc(file) {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf-8')));
  } catch {
    return {};
  }
}

/** Plugin config: walk up from cwd (no host env var on this path). */
function findPluginJsonc(cwd) {
  let dir = path.resolve(cwd || process.cwd());
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'plugin.jsonc');
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** usageEvaluation.enabled with sampling — same defaults as the Claude hook. */
function usageEvalEnabled(cwd) {
  try {
    const pluginPath = findPluginJsonc(cwd);
    if (!pluginPath) return true;
    const cfg = readJsonc(pluginPath);
    const samplingRate = cfg?.config?.usageEvaluation?.samplingRate ?? 1.0;
    if (Math.random() > samplingRate) return false;
    return cfg?.config?.usageEvaluation?.enabled !== false;
  } catch {
    return true;
  }
}

function calibrationActive() {
  try {
    const state = JSON.parse(fs.readFileSync(CALIBRATION_STATE, 'utf-8'));
    return state && state.status === 'active';
  } catch {
    return false;
  }
}

function appendSafe(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch {
    /* best-effort */
  }
}

function humanLine(level, message, kv) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const pairs = kv
    ? Object.entries(kv)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
    : '';
  return `[${ts}] ${level} ${message}${pairs ? ` (${pairs})` : ''}\n`;
}

/** Parse "Context: used: file.md (0.79), other.md (0.74)" from response text. */
function parseUsedFooter(response) {
  const match = response.match(/Context: used:\s*(.+)/);
  if (!match) return [];
  const results = [];
  const re = /([^\s(,]+(?:\s[^\s(,]+)*)\s*\(\d+\.\d+\)/g;
  let m;
  while ((m = re.exec(match[1])) !== null) results.push(m[1].trim());
  return results;
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data || '{}');
  } catch {
    return {};
  }
}

async function main() {
  const payload = await readStdin();
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const project = projectHash(path.resolve(cwd));
  const projectId = project;

  // Muse provides the response directly — no transcript file, no retry loop.
  const response =
    typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message : '';
  if (!response) {
    emitEmpty();
    return;
  }

  const sessionState = readJson(SESSION_STATE, {});
  const injection = sessionState[project];
  if (!injection || !Array.isArray(injection.patterns) || injection.patterns.length === 0) {
    emitEmpty();
    return; // nothing was injected → nothing to log
  }

  const usedPatterns = parseUsedFooter(response);
  const injectedNames = injection.patterns.map((p) => p.id || p.filename || '');

  appendSafe(
    USAGE_PATH,
    JSON.stringify({
      type: 'usage_signal',
      timestamp: new Date().toISOString(),
      project,
      prompt_hash: injection.promptHash || '',
      injected: injectedNames,
      used: usedPatterns,
      usage_rate: injectedNames.length > 0 ? usedPatterns.length / injectedNames.length : 0
    }) + '\n'
  );
  appendSafe(
    DAEMON_LOG_PATH,
    humanLine('INFO', 'Usage signal', {
      used: `${usedPatterns.length}/${injectedNames.length}`,
      rate:
        injectedNames.length > 0
          ? `${Math.round((usedPatterns.length / injectedNames.length) * 100)}%`
          : '0%',
      project
    })
  );

  if (calibrationActive() || usageEvalEnabled(cwd)) {
    try {
      fs.mkdirSync(CONTEXTUS, { recursive: true });
      fs.appendFileSync(
        EVAL_QUEUE,
        JSON.stringify({
          project,
          projectId,
          promptHash: injection.promptHash || '',
          prompt: '',
          thinking: '',
          response,
          patterns: injection.patterns,
          enqueuedAt: new Date().toISOString()
        }) + '\n'
      );
    } catch {
      /* best-effort */
    }
  }

  emitEmpty();
}

main().catch(() => {
  try {
    emitEmpty();
  } catch {
    /* last resort: stay silent, never block turn end */
  }
});
