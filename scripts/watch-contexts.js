#!/usr/bin/env node
/**
 * PostToolUse watcher — incremental re-embed on markdown-file edits.
 *
 * NOT an fs.watch poller ITSELF (those are unreliable cross-platform — missed
 * events on some FUSE/network mounts, double-fire on others). Instead it's
 * event-driven off Claude Code's own PostToolUse hook: whenever a
 * file-mutating tool (Write/Edit/MultiEdit/NotebookEdit) runs, this hook
 * fires and POSTs the touched .md file to the daemon's /notify for a
 * single-file re-embed (which itself skips unchanged content — see
 * embed-file). This is the fast, sub-second path for edits made THROUGH
 * Claude Code's own tools; the daemon separately runs a real fs.watch
 * (watchContextDir, daemon/server.ts) once reconcile has run for a source,
 * which is what catches edits from OUTSIDE Claude Code entirely.
 *
 * Deliberately does NOT hardcode which directory counts as "context" —
 * previously this only recognized `.claude/context/`, so edits under `docs/`
 * (a real, configured source) never even triggered a /notify call (GH issue
 * #22). The daemon's /notify handler already knows the full, per-project
 * MERGED source config (paths, scope, enabled, exclude) and returns a cheap
 * no-op (`not_in_any_source`) for anything outside it — that's the right
 * place to make the routing decision, not a client script duplicating config
 * knowledge it doesn't have without a build step.
 *
 * Thin ESM JS (no build step). Always emits `{ continue: true }`: a re-embed
 * failure must never block the tool result. Daemon-down → fire a background
 * respawn and move on (the file gets picked up by the next full embed or edit).
 */

import crypto from 'node:crypto';
import path from 'node:path';
import { getBaseURL, ensureDaemonRunning } from './lib/daemon-control.js';

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

/**
 * Only .md files are worth notifying about at all — everything else (source
 * code, configs, non-markdown docs) can never be a contextus source. Which
 * SPECIFIC directory it lives under is the daemon's call (determineSource in
 * daemon/server.ts), not this script's — it's the one place that actually
 * knows the merged per-project source config.
 */
function isMarkdownFile(filePath) {
  // Case-insensitive: NOTES.MD / readme.Md are real files on case-preserving
  // filesystems (macOS/Windows) and must not silently skip notification.
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.md');
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
  if (!isMarkdownFile(file)) return emit({ continue: true });

  try {
    await fetch(`${getBaseURL()}/notify`, {
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
