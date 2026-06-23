#!/usr/bin/env node
/**
 * Stop hook — usage signal capture + calibration job enqueuer.
 *
 * Fires after Claude finishes a response. NON-BLOCKING and near-zero cost: it
 * does NO model call. Two responsibilities:
 *
 * 1. ALWAYS: Parse the "Context: used:" footer from the response and log a
 *    usage_signal event. This gives us the headline metric: "context was used
 *    in XX% of responses where it was injected."
 *
 * 2. CALIBRATION ONLY: If a calibration campaign is active, enqueue the full
 *    turn (thinking + response + injected patterns) for Haiku grading.
 *
 * Plain ESM JS (no build step). Always emits nothing on stdout — Stop hooks
 * don't need to return JSON.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const CONTEXTUS = path.join(HOME, '.contextus');
const LOG_DIR = path.join(CONTEXTUS, 'logs');
const USAGE_PATH = path.join(LOG_DIR, 'usage.jsonl');
const DAEMON_LOG_PATH = path.join(LOG_DIR, 'daemon.log');
const CALIBRATION_STATE = path.join(CONTEXTUS, 'calibration-state.json');
const SESSION_STATE = path.join(CONTEXTUS, '.session-state.json');
const EVAL_QUEUE = path.join(CONTEXTUS, '.eval-queue.jsonl');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function appendSafe(file, line) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch { /* best-effort */ }
}

function humanLine(level, message, kv) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const pairs = kv
    ? Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(', ')
    : '';
  const suffix = pairs ? ` (${pairs})` : '';
  return `[${ts}] ${level} ${message}${suffix}\n`;
}

/** Parse "Context: used: file.md (0.79), other.md (0.74)" from response text. */
function parseUsedFooter(response) {
  const match = response.match(/Context: used:\s*(.+)/);
  if (!match) return [];
  const line = match[1];
  const results = [];
  const re = /([^\s(,]+(?:\s[^\s(,]+)*)\s*\((\d+\.\d+)\)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    results.push(m[1].trim());
  }
  return results;
}

/** Calibration only runs when a campaign is active. */
function calibrationActive() {
  const s = readJson(CALIBRATION_STATE, null);
  return !!(s && s.evaluateUsage);
}

/**
 * Pull the last assistant turn's thinking + visible text from a transcript JSONL.
 */
function lastTurnFromTranscript(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return { thinking: '', response: '' };
  }
  const thinking = [];
  const response = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.type === 'user') break;
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
    for (const block of o.message.content) {
      if (block.type === 'thinking' && block.thinking) thinking.unshift(block.thinking);
      else if (block.type === 'text' && block.text) response.unshift(block.text);
    }
  }
  return { thinking: thinking.join('\n'), response: response.join('\n') };
}

function projectFromCwd(cwd) {
  return cwd ? path.basename(cwd) : path.basename(process.cwd());
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return;
  }

  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const project = projectFromCwd(cwd);

  // What did /query inject for this project's most recent prompt?
  const sessionState = readJson(SESSION_STATE, {});
  const injection = sessionState[project];
  if (!injection || !Array.isArray(injection.patterns) || injection.patterns.length === 0) {
    return; // nothing was injected → nothing to log
  }

  const { thinking, response } = lastTurnFromTranscript(payload.transcript_path);
  if (!response) return; // no response to parse

  // --- Always: log usage signal from footer ---
  const usedPatterns = parseUsedFooter(response);
  const injectedNames = injection.patterns.map((p) => p.id || p.filename || '');

  const record = {
    type: 'usage_signal',
    timestamp: new Date().toISOString(),
    project,
    prompt_hash: injection.promptHash || '',
    injected: injectedNames,
    used: usedPatterns,
    usage_rate: injectedNames.length > 0
      ? usedPatterns.length / injectedNames.length
      : 0
  };
  appendSafe(USAGE_PATH, JSON.stringify(record) + '\n');
  appendSafe(
    DAEMON_LOG_PATH,
    humanLine('INFO', 'Usage signal', {
      used: `${usedPatterns.length}/${injectedNames.length}`,
      rate: injectedNames.length > 0
        ? `${Math.round((usedPatterns.length / injectedNames.length) * 100)}%`
        : '0%',
      project
    })
  );

  // --- Calibration: enqueue eval job if campaign active ---
  if (calibrationActive()) {
    const job = {
      project,
      promptHash: injection.promptHash || '',
      prompt: '',
      thinking,
      response,
      patterns: injection.patterns,
      enqueuedAt: new Date().toISOString(),
    };
    try {
      fs.mkdirSync(CONTEXTUS, { recursive: true });
      fs.appendFileSync(EVAL_QUEUE, JSON.stringify(job) + '\n');
    } catch { /* best-effort */ }
  }
}

main();
