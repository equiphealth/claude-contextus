#!/usr/bin/env node
/**
 * Muse PostToolUse: incremental re-embed trigger.
 *
 * Mirrors scripts/watch-contexts.js on native Muse tool names
 * (`write_file|edit_file`): only `.md` files are notified; routing
 * (`not_in_any_source`) stays daemon-owned — the client never hardcodes
 * `.claude/context` (GH #22 rule). Silent by design in Phase 1: emits an
 * empty object, no feedback context. Always exit 0 — a re-embed failure
 * must never affect the tool result.
 */

import path from 'node:path';
import { projectHash } from '../../scripts/lib/project-hash.js';
import { getBaseURL } from '../../scripts/lib/daemon-control.js';
import { emitEmpty } from '../shared/emit.js';

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

/** Tolerant path extraction: `path`, with `file_path`/`notebook_path` fallback. */
function editedFilePath(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return null;
  for (const key of ['path', 'file_path', 'notebook_path']) {
    const v = toolInput[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

async function main() {
  const payload = await readStdin();
  const relPath = editedFilePath(payload.tool_input);
  if (!relPath || !relPath.endsWith('.md')) {
    emitEmpty();
    return;
  }
  const cwd = payload.cwd || process.cwd();
  const abs = path.resolve(cwd);
  try {
    await fetch(`${getBaseURL()}/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filePath: relPath,
        absolutePath: path.isAbsolute(relPath) ? relPath : path.join(abs, relPath),
        project: abs,
        projectId: projectHash(abs),
        cwd: abs,
        sessionId: payload.session_id || process.env.MUSE_SESSION_ID,
        agent: 'muse'
      }),
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    /* re-embed failure is invisible; fs.watch remains the backstop */
  }
  emitEmpty();
}

main().catch(() => {
  try {
    emitEmpty();
  } catch {
    /* last resort: stay silent, never affect the tool result */
  }
});
