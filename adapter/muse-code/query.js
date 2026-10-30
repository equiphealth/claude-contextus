#!/usr/bin/env node
/**
 * Muse UserPromptSubmit: merged single injection (retrieval + awareness footer).
 *
 * One hook, one additionalContext. Retrieval relay (POST /query) plus the
 * novelty-aware capture footer are assembled internally and emitted as a single
 * merged block: [contextus] header, chunks, whitelisted provenance footer, then
 * the awareness footer text. Two separate hook outputs both arrive on the wire
 * but minimal-effort models drop the second (Phase 0); merging removes both
 * that hazard and any dependence on serial hook order (hooks run concurrently).
 *
 * Plain ESM JavaScript, no build step. Fail-open everywhere: any failure
 * degrades to empty success — a missed injection, never a blocked prompt.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHash } from '../../scripts/lib/project-hash.js';
import { getBaseURL, ensureDaemonRunning } from '../../scripts/lib/daemon-control.js';
import { stripJsonComments } from '../../scripts/lib/parse-jsonc.js';
import { emitMerged, emitEmpty } from '../shared/emit.js';

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Plugin root is one level up from adapter/ — same layout as scripts/. */
const PLUGIN_ROOT = path.resolve(ADAPTER_DIR, '..', '..');
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

function readJsonc(file) {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
  } catch {
    return {};
  }
}

/** Per-project override wins (host-neutral file read: .claude/ until §5 lands). */
function captureConfig(cwd) {
  try {
    const f = path.join(cwd, '.claude', 'contextus.jsonc');
    if (fs.existsSync(f)) return readJsonc(f).contextCapture || {};
  } catch {
    /* fall through to plugin default */
  }
  return captureConfigFromPlugin();
}

function captureConfigFromPlugin() {
  try {
    return readJsonc(path.join(PLUGIN_ROOT, 'plugin.jsonc')).config?.contextCapture || {};
  } catch {
    return { enabled: false };
  }
}

function readAwarenessPrompts(mode) {
  const read = (name) => {
    try {
      return fs.readFileSync(path.join(PLUGIN_ROOT, 'prompts', name), 'utf8').trim();
    } catch {
      return null;
    }
  };
  if (mode === 'staging') return read('staging-footer.txt');
  return read('awareness-footer.txt');
}

/** Session stats for the capacity guard — Muse session_id wins, env is fallback. */
function readContextStats(sessionId) {
  if (!sessionId) return undefined;
  const file = path.join(RUNTIME_DIR, `${sessionId}.context-stats.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

async function postJson(url, body, timeoutMs) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function main() {
  const payload = await readStdin();
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  const cwd = payload.cwd || process.cwd();
  if (!prompt.trim()) {
    emitEmpty();
    return;
  }

  const abs = path.resolve(cwd);
  const projectId = projectHash(abs);
  const sessionId = payload.session_id || process.env.MUSE_SESSION_ID || undefined;

  let daemon;
  try {
    daemon = await ensureDaemonRunning().then(() => getBaseURL());
  } catch {
    daemon = getBaseURL();
  }

  const out = await postJson(
    `${daemon}/query`,
    {
      prompt,
      project: projectId,
      projectId,
      cwd: abs,
      contextStats: readContextStats(sessionId),
      sessionId,
      agent: 'muse',
      hookEvent: 'UserPromptSubmit'
    },
    8000
  ).catch(() => null);

  if (!out || typeof out !== 'object' || !out.hookSpecificOutput) {
    try {
      await ensureDaemonRunning();
    } catch {
      /* one restart attempt; a miss is fine */
    }
    emitEmpty();
    return;
  }

  // --- Awareness footer (merged into the same block, §1.4) ---
  const cfg = { ...captureConfigFromPlugin(), ...captureConfig(abs) };
  let footer = '';
  if (cfg.enabled !== false) {
    const mode = cfg.mode || 'staging';
    if (mode !== 'silent') {
      const text = readAwarenessPrompts(mode);
      if (text) {
        let staged = 0;
        let existing = 0;
        try {
          const nov = await postJson(`${daemon}/novelty`, { prompt, projectId, cwd: abs }, 3000);
          staged = Number.isFinite(nov?.stagedCount) ? nov.stagedCount : 0;
          existing = Number.isFinite(nov?.existingCount) ? nov.existingCount : 0;
        } catch {
          /* footer degrades to uncounted; novelty failure never blocks */
        }
        footer = text
          .replace('{stagedCount}', String(staged))
          .replace('{existingCount}', String(existing));
      }
    }
  }

  emitMerged({
    hookEventName: 'UserPromptSubmit',
    daemonBlock: out.hookSpecificOutput.additionalContext || '',
    footer
  });
}

main().catch(() => {
  try {
    emitEmpty();
  } catch {
    /* last resort: stay silent, never block the prompt */
  }
});
