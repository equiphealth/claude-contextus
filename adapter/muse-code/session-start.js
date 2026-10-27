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
  ensureDaemonRunning,
  getHealth,
  getVerbosity,
  checkCorpus,
  fireReconcile,
  hasAgentsStanza,
  readSetupStamp,
  sleep
} from '../../scripts/lib/daemon-control.js';

/**
 * Hard ceiling for the whole warm sequence (spawn + waits + checks). The
 * manifest kills this hook at 15 s; a killed hook delivers no nudge, so the
 * budget is structural, not arithmetic. When the race loses, the checks
 * below run on best-known state (daemon treated as down → nudge fires).
 */
const START_BUDGET_MS = 12000;
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

  const cheap = source === 'clear' || source === 'fork';
  const warmOnly = source === 'resume' || source === 'compact';

  const verbose = getVerbosity() === 'verbose';
  const hasStanza = hasAgentsStanza(cwd);
  const projectId = projectHash(path.resolve(cwd));

  // Background reconcile check — never hangs session start.
  fireReconcile(projectId, cwd).catch(() => {});

  // Best-known daemon state. Everything networked runs inside the raced
  // block; file reads above stay outside (instant). If the budget race
  // loses, daemonOk stays false and the nudge below fires — the safe side.
  let daemonOk = false;
  let corpus = null;
  const warm = (async () => {
    try {
      if (cheap) {
        // Cheap path: no spawn, no wait. The daemonOk check below still
        // nudges on a down daemon; it just isn't restarted from here.
      } else if (warmOnly) {
        // Warm check: no spawn; one short grace wait only if unhealthy now.
        const probe = await getHealth(1000).catch(() => null);
        if (!probe || probe.modelLoaded === false) await waitForModel(5000);
      } else {
        const already = await ensureDaemonRunning();
        // Cold-start patience lives inside the race budget, not beyond it:
        // a spurious nudge this session (quiet next) beats a killed hook.
        if (!already) await waitForModel(8000);
        else await waitForModel(5000);
      }
    } catch {
      // Daemon unreachable: the setup nudge below covers it. Never block.
    }
    corpus = await checkCorpus(projectId, cwd).catch(() => null);
    const health = await getHealth(1000).catch(() => null);
    daemonOk = !!(health && health.modelLoaded !== false);
  })();
  warm.catch(() => {}); // stragglers settle silently after we've moved on
  await Promise.race([warm, sleep(START_BUDGET_MS)]);

  // Bounded exit grace: idle keep-alive sockets must not push total runtime
  // past the 15 s manifest kill (emit at ≤12 s + this grace ≤14 s worst
  // case). Unref'd: if the loop drains naturally first, this never fires.
  // In-flight best-effort work (fireReconcile, warm stragglers) gets whatever
  // time it gets; the nudge below is already decided and never waits for it.
  setTimeout(() => process.exit(0), 2000).unref();

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
