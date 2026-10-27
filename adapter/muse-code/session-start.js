#!/usr/bin/env node
/**
 * Muse SessionStart: warm the daemon, check corpus health, nudge setup.
 *
 * Fires on session start (matched on source: startup|resume|clear|fork).
 * Mirrors scripts/session-start-hook.js without the Claude-only paths:
 * no CLAUDE_PLUGIN_DATA bootstrap, no dist build, no transcript mining
 * (Muse hands hooks last_assistant_message instead), no CLAUDE.md check —
 * the discoverability check looks for an AGENTS.md stanza instead and still
 * never edits it (setup owns that).
 *
 * Zero-dependency (node stdlib only + scripts/lib): it runs before setup
 * completes, so it cannot require installed deps. Bounded polling, never
 * hangs session start; any failure degrades to silence, never a block.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectHash } from '../../scripts/lib/project-hash.js';
import {
  getBaseURL,
  ensureDaemonRunning,
  getHealth,
  getVerbosity,
  checkCorpus,
  fireReconcile,
  hasAgentsStanza,
  readSetupStamp,
  STANZA_START
} from '../../scripts/lib/daemon-control.js';
import { emitContext, emitSystemMessage, emitEmpty } from '../shared/emit.js';

const ADAPTER_DIR = path.dirname(fileURLToPath(import.meta.url));

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

async function waitForModel(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const health = await getHealth(1000);
    if (health?.modelLoaded) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  const probe = await getHealth(1000, { probe: true });
  return !!(probe && probe.modelLoaded);
}

async function main() {
  const payload = await readStdin();
  const cwd = payload.cwd || process.cwd();
  const source = payload.source || 'startup';

  try {
    const already = await ensureDaemonRunning();
    if (!already) await waitForModel(15000);
    else await waitForModel(5000);
  } catch {
    // Daemon unreachable: the setup nudge below covers it. Never block start.
  }

  // Background reconcile check — never hangs session start.
  const projectId = projectHash(path.resolve(cwd));
  fireReconcile(projectId, cwd).catch(() => {});

  const verbose = getVerbosity() === 'verbose';
  const corpus = await checkCorpus(projectId, cwd).catch(() => null);
  const hasStanza = hasAgentsStanza(cwd);
  const health = await getHealth(1000).catch(() => null);
  const daemonOk = !!(health && health.modelLoaded !== false);

  // Setup nudge: the one-time "run /setup first" reminder. Fires while the
  // setup stamp is missing (setup never completed here) or the daemon is
  // down; quiet forever once setup completes AND the daemon answers. The
  // stamp alone never silences a dead daemon. Rides additionalContext so it
  // can ask the model to act, unlike a bare systemMessage. Inert until hooks
  // are approved — the setup skill (which runs unapproved) is the backstop
  // for the pre-approval window.
  const stamp = readSetupStamp(cwd);
  if (!stamp || !daemonOk) {
    const reason = !daemonOk
      ? 'the Contextus daemon is not reachable'
      : 'setup has not been completed in this project';
    emitContext({
      hookEventName: 'SessionStart',
      additionalContext:
        `[contextus] Setup needed: ${reason}. ` +
        `Run the contextus-setup skill (/setup) to install dependencies, start the daemon, and scaffold the corpus. ` +
        `Until then, no project context will be injected.`
    });
    return;
  }

  if (verbose) {
    const parts = ['[contextus] daemon warm'];
    if (corpus && typeof corpus.totalEmbeddings === 'number') {
      parts.push(`${corpus.totalEmbeddings} embeddings`);
    }
    if (!hasStanza) {
      parts.push(
        'tip: add the contextus stanza to AGENTS.md via /setup for project rules discovery'
      );
    }
    emitSystemMessage(parts.join(' · '));
    return;
  }

  if (!hasStanza) {
    emitSystemMessage(
      '[contextus] tip: add the contextus stanza to AGENTS.md via /setup for project rules discovery'
    );
    return;
  }

  emitEmpty();
}

main().catch(() => {
  try {
    emitEmpty();
  } catch {
    /* last resort: stay silent, never block session start */
  }
});
