#!/usr/bin/env node
/**
 * Muse PostLLMCall: capacity usage accumulator (Phase 1, optional, off by default).
 *
 * Reads per-call `usage` + `session_id` from stdin and maintains cumulative
 * per-session totals at ~/.contextus/runtime/<sessionId>.context-stats.json —
 * the same file shape the Claude statusline hook writes, so the daemon guard
 * needs no change. A `used_percentage` already present (e.g. written by a
 * Claude statusline in a mixed-host session) is preserved verbatim; this hook
 * never invents a percentage — without an explicit
 * capacityProtection.contextWindowTokens the daemon treats cumulative tokens
 * as no-adjustment (fail-open). Always exit 0.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitEmpty } from '../shared/emit.js';

const RUNTIME_DIR = path.join(os.homedir(), '.contextus', 'runtime');

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
  const sessionId = payload.session_id || process.env.MUSE_SESSION_ID;
  const usage = payload.usage && typeof payload.usage === 'object' ? payload.usage : null;
  if (!sessionId || !usage) {
    emitEmpty();
    return;
  }

  const file = path.join(RUNTIME_DIR, `${sessionId}.context-stats.json`);
  let prev = {};
  try {
    prev = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    prev = {};
  }
  const next = {
    input_tokens: (prev.input_tokens || 0) + (usage.input_tokens || 0),
    output_tokens: (prev.output_tokens || 0) + (usage.output_tokens || 0),
    updatedAt: new Date().toISOString()
  };
  // Preserve a percentage written by another host; never invent one.
  if (typeof prev.used_percentage === 'number' && prev.used_percentage > 0) {
    next.used_percentage = prev.used_percentage;
  }
  try {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next));
  } catch {
    /* best-effort; missing file = no adjustment, never an error */
  }
  emitEmpty();
}

main().catch(() => {
  try {
    emitEmpty();
  } catch {
    /* last resort */
  }
});
