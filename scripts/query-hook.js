#!/usr/bin/env node
/**
 * UserPromptSubmit query hook — thin HTTP client to the daemon's /query.
 *
 * Reads the hook payload from stdin (`{ prompt, cwd, ... }`), computes the
 * projectId hash (sha256 of abs path, first 12 chars), POSTs to the daemon,
 * and passes its response straight through to Claude Code. The daemon already
 * returns the exact hook output shape, so this stays a pure relay.
 *
 * Graceful degradation (DESIGN.md): if the daemon is unreachable, fire a
 * background restart and emit `{ continue: true }` — one missed injection, never
 * a blocked prompt. Bounded 10s timeout (hook also has a 10s timeout in hooks.json).
 */

import path from 'node:path';
import fs from 'node:fs';
import { projectHash } from './lib/project-hash.js';
import { getBaseURL, ensureDaemonRunning } from './lib/daemon-control.js';

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

/** Read context-window stats written by statusline (best-effort). */
function readContextStats() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) return undefined;
  const statsPath = path.join(
    process.env.HOME || '/tmp',
    '.contextus', 'runtime', `${sessionId}.context-stats.json`
  );
  try {
    return JSON.parse(fs.readFileSync(statsPath, 'utf8'));
  } catch {
    return undefined;
  }
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
    const res = await fetch(`${getBaseURL()}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt,
        project: projectHash(cwd || process.cwd()),
        cwd,
        contextStats: readContextStats(),
        sessionId: process.env.CLAUDE_CODE_SESSION_ID
      }),
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
