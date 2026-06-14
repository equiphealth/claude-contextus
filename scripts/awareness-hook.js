#!/usr/bin/env node
/**
 * UserPromptSubmit awareness hook — the capture half of the loop.
 *
 * The query hook (query-hook.js) RETRIEVES; this one nudges CAPTURE. It appends a
 * short footer instruction telling Claude to propose a new context file when the
 * exchange surfaces a genuinely new, reusable pattern — gated by a NOVELTY SIGNAL
 * so Claude doesn't propose things contextus already has.
 *
 * Novelty signal: we ask the daemon (GET /novelty) what it has recently injected
 * for this project and pass those filenames into the footer. "You already have
 * patterns on X, Y, Z — only propose if the insight isn't covered there." This is
 * the Phase-3 "novelty signal derived from the injected set" requirement: capture
 * is informed by what retrieval already surfaced.
 *
 * Replaces the inline echo footer that hooks.json carried as a Phase-2 placeholder
 * (same UserPromptSubmit slot). Thin ESM JS; always emits the footer via
 * additionalContext and never blocks the prompt.
 *
 * Capture mode (plugin.json config.contextCapture.mode): 'propose' (default) asks
 * Claude to surface a footer + invoke /create-context; 'silent' suppresses the
 * footer entirely. ('auto' write-without-asking is a v2 concern — treated as
 * 'propose' here.)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BASE_URL } from './lib/daemon-control.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_JSON = path.resolve(__dirname, '..', 'plugin.json');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    if (process.stdin.isTTY) resolve('');
  });
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function projectName(cwd) {
  return cwd ? path.basename(cwd) : path.basename(process.cwd());
}

/** Read contextCapture.mode from plugin.json (plain JS can't import config.ts). */
function captureMode() {
  try {
    const cfg = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
    return cfg?.config?.contextCapture?.mode ?? 'propose';
  } catch {
    return 'propose';
  }
}

/** Ask the daemon what it has recently injected for this project (best-effort). */
async function recentPatterns(project) {
  try {
    const res = await fetch(`${BASE_URL}/novelty?project=${encodeURIComponent(project)}`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body.recent) ? body.recent : [];
  } catch {
    return [];
  }
}

/** Build the footer instruction, folding in the novelty signal if we have one. */
function buildFooter(recent) {
  const base =
    'Context awareness: if this exchange surfaced a NEW, reusable pattern/decision/gotcha, ' +
    'end your response with a footer line: "Context: propose: <topic-name>" (and invoke ' +
    '/create-context to capture it). If you used injected context, instead end with ' +
    '"Context: used: <filename(s)>". Omit the footer for brief/trivial replies.';
  if (recent.length === 0) return base;
  const list = recent.slice(-8).join(', ');
  return (
    `${base} NOVELTY CHECK — contextus already has patterns on: ${list}. ` +
    'Only propose if your insight is genuinely not covered by those.'
  );
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return emit({ continue: true });
  }

  if (captureMode() === 'silent') return emit({ continue: true });

  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const recent = await recentPatterns(projectName(cwd));

  emit({
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildFooter(recent),
    },
  });
}

main();
