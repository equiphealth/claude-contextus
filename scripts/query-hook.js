#!/usr/bin/env node
/**
 * UserPromptSubmit query hook — thin HTTP client to the daemon's /query.
 *
 * Reads the hook payload from stdin (`{ prompt, cwd, ... }`), derives the project
 * name the same way the daemon's resolveDBPath does (cwd basename), POSTs to the
 * daemon, and passes its response straight through to Claude Code. The daemon
 * already returns the exact hook output shape, so this stays a pure relay.
 *
 * Graceful degradation (DESIGN.md): if the daemon is unreachable, fire a
 * background restart and emit `{ continue: true }` — one missed injection, never
 * a blocked prompt. Bounded 10s timeout (hook also has a 10s timeout in hooks.json).
 */

import path from 'node:path';
import { BASE_URL, ensureDaemonRunning } from './lib/daemon-control.js';

/** Read all of stdin as a string (the hook payload JSON). */
function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    // If nothing is piped, don't hang.
    if (process.stdin.isTTY) resolve('');
  });
}

/** Project name = git/dir basename of cwd — matches the daemon's default. */
function projectName(cwd) {
  return cwd ? path.basename(cwd) : path.basename(process.cwd());
}

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return emit({ continue: true });
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  if (!prompt.trim()) return emit({ continue: true });

  try {
    const res = await fetch(`${BASE_URL}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, project: projectName(cwd), cwd }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return emit({ continue: true });
    const body = await res.json();
    return emit(body);
  } catch {
    // Daemon down or slow — restart in the background, skip this injection.
    ensureDaemonRunning().catch(() => {});
    return emit({ continue: true });
  }
}

main();
