#!/usr/bin/env node
/**
 * Stop hook — calibration job enqueuer (evaluation-architecture memory).
 *
 * Fires after Claude finishes a response. NON-BLOCKING and near-zero cost: it
 * does NO model call. It just (1) checks whether a calibration campaign is
 * active, (2) reconstructs the last turn (thinking + response) from the
 * transcript, (3) matches it against what /query injected (session state), and
 * (4) appends one job to the eval queue. The background eval-worker does the
 * actual Haiku grading on its own clock — so Claude's response is never delayed.
 *
 * Thinking blocks are the trick: with Claude's own reasoning in the job, the
 * grader's task becomes "did Claude say it used this?" not "infer relevance" —
 * which is why even a small model can do it (ollama-model-quality).
 *
 * Plain ESM JS (the repo is "type": "module", like the sibling hooks — NOT
 * CommonJS `require`). No build step for hooks and dependency-free: the
 * daemon-side libs are .ts; this hook reads the same files (~/.contextus/...)
 * directly to stay independent of tsx at hook time.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const HOME = os.homedir();
const CONTEXTUS = path.join(HOME, '.contextus');
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

/** Calibration only runs when a campaign is active — cheap early bail otherwise. */
function calibrationActive() {
  const s = readJson(CALIBRATION_STATE, null);
  return !!(s && s.evaluateUsage);
}

/**
 * Pull the last assistant turn's thinking + visible text out of a transcript
 * JSONL. Walks from the end: collects the final contiguous run of assistant
 * messages (one logical turn can span several lines) until we hit a user line.
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
    if (o.type === 'user') break; // reached the prompt that opened this turn
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
  // Always exit cleanly — a Stop hook must never disrupt the session.
  if (!calibrationActive()) return;

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
    return; // nothing was injected → nothing to grade
  }

  const { thinking, response } = lastTurnFromTranscript(payload.transcript_path);

  const job = {
    project,
    promptHash: injection.promptHash || '',
    prompt: '', // not stored (privacy: only the hash is); thinking+response carry the signal
    thinking,
    response,
    patterns: injection.patterns,
    enqueuedAt: new Date().toISOString(),
  };

  try {
    fs.mkdirSync(CONTEXTUS, { recursive: true });
    fs.appendFileSync(EVAL_QUEUE, JSON.stringify(job) + '\n');
  } catch {
    /* best-effort: a missed eval just means one fewer calibration sample */
  }
}

main();
