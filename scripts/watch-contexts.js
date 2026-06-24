#!/usr/bin/env node
/**
 * PostToolUse watcher — incremental re-embed on context-file edits.
 *
 * NOT an fs.watch poller (those are unreliable cross-platform — missed events on
 * some FUSE/network mounts, double-fire on others). Instead it's event-driven off
 * Claude Code's own PostToolUse hook: whenever a file-mutating tool (Write/Edit/
 * MultiEdit/NotebookEdit) runs, this hook fires, we check whether the touched file
 * lives under `.claude/context/`, and if so POST it to the daemon's /notify for a
 * single-file re-embed (which itself skips unchanged content — see embed-file).
 *
 * Thin ESM JS (no build step). Always emits `{ continue: true }`: a re-embed
 * failure must never block the tool result. Daemon-down → fire a background
 * respawn and move on (the file gets picked up by the next full embed or edit).
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { BASE_URL, ensureDaemonRunning } from './lib/daemon-control.js';

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

function projectId(cwd) {
  const abs = path.resolve(cwd || process.cwd());
  return crypto.createHash('sha256').update(abs).digest('hex').slice(0, 12);
}

/**
 * Pull the edited file path out of a PostToolUse payload. Claude Code nests the
 * tool args under tool_input; Write/Edit/MultiEdit use `file_path`,
 * NotebookEdit uses `notebook_path`. Returns null when no path is present (e.g.
 * a Bash tool call — nothing to re-embed).
 */
function editedFilePath(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? {};
  return input.file_path ?? input.notebook_path ?? input.path ?? null;
}

/** Only .md files under a `.claude/context` segment are worth notifying about. */
function isContextFile(filePath, cwd) {
  if (!filePath || !filePath.endsWith('.md')) return false;
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return abs.includes(`${path.sep}.claude${path.sep}context${path.sep}`);
}

async function main() {
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {
    return emit({ continue: true });
  }

  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd();
  const file = editedFilePath(payload);
  if (!isContextFile(file, cwd)) return emit({ continue: true });

  try {
    await fetch(`${BASE_URL}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, cwd, project: projectId(cwd) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Daemon down/slow — re-embed is best-effort; restart it for next time.
    ensureDaemonRunning().catch(() => {});
  }
  return emit({ continue: true });
}

main();
