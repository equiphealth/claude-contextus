#!/usr/bin/env node
/**
 * contextus-setup — the EXPLICIT half of first-run onboarding (the skill engine).
 *
 * This is the ONLY thing in the system that edits the project rules file
 * (CLAUDE.md, or AGENTS.md with --host muse). A hook must never auto-edit an
 * outward-facing, user-owned file (first-run-onboarding memory); the cheap
 * invisible corpus embed may be automatic (session-start auto-reconcile), but
 * the visible file edit is opt-in and lives here, behind a marked block.
 *
 * What it does, all idempotent:
 *   1. Scaffold `.claude/context/` + a starter `CONTEXT.md` index if absent.
 *   2. Upsert a marked, idempotent contextus stanza into the project rules file
 *      (<!-- contextus:start --> … <!-- contextus:end -->) — re-running updates
 *      in place, never duplicates.
 *   3. Ensure the daemon: reuse a healthy one, else sync the neutral home
 *      (~/.contextus/daemon), start it, verify /health + model warm.
 *      Throws on failure — no stamp, non-zero exit.
 *   4. Run the initial embed (reconcile the corpus from the context files).
 *   5. Write the setup-completion stamp the SessionStart hook reads.
 *
 * Usage:
 *   pnpm contextus-setup                 # set up the current project (cwd)
 *   pnpm contextus-setup --dir <path>    # set up a specific project root
 *   pnpm contextus-setup --host muse     # Muse host: stanza goes to AGENTS.md
 *   pnpm contextus-setup --no-embed      # scaffold + stanza only, skip embedding
 *   pnpm contextus-setup --mine-transcripts   # also run a one-time transcript-mining
 *                                              # bootstrap scan (~1 week of history) —
 *                                              # the skill only passes this when the
 *                                              # user says yes (GH issue #39)
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  upsertStanza,
  hasStanza,
  removeStanza,
  HOST_STANZA,
  type SetupHost
} from '../lib/capture/claude-md-stanza.js';
import {
  writeSetupStamp,
  syncNeutralDaemon,
  noteDaemonVersion,
  NEUTRAL_DIST_SERVER
} from './lib/daemon-control.js';
import { getDaemonURL } from '../lib/daemon-url.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { tableExists, countRows } from '../lib/storage/lance-client.js';
import { runFloorReplay, ReplayError } from '../lib/calibration/floor-replay.js';
import { printFloorReport } from '../lib/calibration/floor-report.js';
import { buildChanges, renderDiff, hasRealChanges } from '../lib/calibration/config-write.js';
import { loadConfig, projectLocalConfigPath } from '../lib/config.js';
import { mineProject } from './mine-transcripts.js';

/** GET /health, parsed or null. Never throws (down-ness is data here). */
async function readDaemonHealth(
  timeoutMs = 10000
): Promise<{ modelLoaded?: unknown; version?: unknown } | null> {
  try {
    const res = await fetch(`${getDaemonURL()}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    return (await res.json()) as { modelLoaded?: unknown; version?: unknown };
  } catch {
    return null;
  }
}

/**
 * Setup-time daemon guarantee: reuse a healthy daemon wherever it runs,
 * else sync the neutral home, start it detached, and poll /health until the
 * model is warm. Throws with the exact recovery step on any failure — the
 * caller exits non-zero and no completion stamp is written.
 */
async function ensureDaemonReady(): Promise<void> {
  const running = await readDaemonHealth();
  if (running) {
    // Reuse wins over code path (condition 1): never restart, never upgrade
    // under a live session. Drift only warns (inside noteDaemonVersion).
    noteDaemonVersion(running);
    console.log('  daemon           already running (reused — not restarted)');
    return;
  }
  console.log('  daemon           syncing neutral home…');
  const sync = syncNeutralDaemon({ log: (m) => console.log(`  neutral daemon  ${m}`) });
  console.log(
    `  neutral daemon   ${sync.synced ? 'synced' : 'already in sync'} (${sync.found || sync.expected})`
  );
  if (!fs.existsSync(NEUTRAL_DIST_SERVER)) {
    throw new Error(`neutral dist entry missing after sync: ${NEUTRAL_DIST_SERVER}`);
  }
  const child = spawn(process.execPath, [NEUTRAL_DIST_SERVER], {
    detached: true,
    stdio: 'ignore'
  });
  child.unref();
  console.log('  daemon           spawned, waiting for model warm…');
  const deadline = Date.now() + 90000;
  for (;;) {
    const health = await readDaemonHealth(5000);
    if (health && health.modelLoaded) {
      noteDaemonVersion(health);
      console.log('  daemon           reachable and model warm');
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        'daemon started but /health never reported modelLoaded within 90 s. ' +
          'Check the embedding provider (Ollama) and rerun setup — setup re-verifies from scratch.'
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

interface Args {
  dir: string;
  embed: boolean;
  tune: boolean;
  mineTranscripts: boolean;
  host: SetupHost;
}

function parseArgs(argv: string[]): Args {
  let dir = process.cwd();
  let embed = true;
  let tune = false;
  let mineTranscripts = false;
  let host: SetupHost = 'claude';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else if (argv[i] === '--no-embed') embed = false;
    else if (argv[i] === '--tune') tune = true;
    else if (argv[i] === '--mine-transcripts') mineTranscripts = true;
    else if (argv[i] === '--host' && argv[i + 1]) {
      const next = argv[++i];
      if (next !== 'claude' && next !== 'muse') {
        throw new Error(`--host must be 'claude' or 'muse', got '${next}'`);
      }
      host = next;
    }
  }
  return { dir, embed, tune, mineTranscripts, host };
}

/** A small, honest starter index so a fresh project has somewhere to grow. */
const STARTER_CONTEXT_MD = `# Project Context Index

This directory holds curated patterns, decisions, and gotchas for this project.
claude-contextus embeds these and injects the relevant ones into each prompt
automatically — no searching required.

Add files under category folders (\`decisions/\`, \`gotchas/\`, \`architecture/\`,
\`reference/\`, …). Each file carries frontmatter:

\`\`\`markdown
---
name: short-slug
description: one-line summary used for retrieval relevance
metadata:
  type: decision        # decision | gotcha | arch | reference | …
  tags: [optional, topic, tags]
---

The pattern itself.
\`\`\`

## Decisions

_(none yet — capture your first with /create-context)_
`;

function scaffoldContextDir(root: string): { createdDir: boolean; createdIndex: boolean } {
  const ctxDir = path.join(root, '.claude', 'context');
  const indexFile = path.join(ctxDir, 'CONTEXT.md');
  const createdDir = !fs.existsSync(ctxDir);
  if (createdDir) fs.mkdirSync(ctxDir, { recursive: true });
  const createdIndex = !fs.existsSync(indexFile);
  if (createdIndex) fs.writeFileSync(indexFile, STARTER_CONTEXT_MD);
  return { createdDir, createdIndex };
}

/**
 * Upsert the stanza into the host's project rules file (creating it if
 * absent). Muse mode targets AGENTS.md with the generic body; Claude mode
 * keeps the existing CLAUDE.md behavior byte-for-byte.
 *
 * First-create seeding: if `file` doesn't exist yet AND its sibling
 * (`seedFrom` — CLAUDE.md for muse, AGENTS.md for claude) does, mirror the
 * sibling's real content (minus its own stanza) instead of starting from an
 * empty file that would otherwise contain nothing but the contextus stanza.
 * Without this, a project onboarded to a second host loses all of its actual
 * conventions for that host — only an unenforced "keep them in sync by hand"
 * expectation remained. Only fires on first create; an existing `file` is
 * never overwritten by its sibling's content on a re-run.
 */
function writeStanza(
  root: string,
  host: SetupHost
): { created: boolean; changed: boolean; seeded: boolean } {
  const { file, body, seedFrom } = HOST_STANZA[host];
  const filePath = path.join(root, file);
  const fileExisted = fs.existsSync(filePath);
  let existing = fileExisted ? fs.readFileSync(filePath, 'utf8') : '';
  const created = existing === '';
  let seeded = false;

  if (!fileExisted) {
    const seedPath = path.join(root, seedFrom);
    if (fs.existsSync(seedPath)) {
      const seedContent = fs.readFileSync(seedPath, 'utf8');
      // Mechanical copy only — a script cannot judge which prose is
      // host-portable vs. specific to the sibling's harness (skill
      // invocation syntax, hook names, tool names that don't map 1:1).
      // Getting that right is a judgment call for whoever reads the result
      // next (human or a model session), not something safe to guess here.
      // The flag comment below (outside the stanza markers, so it's the
      // user's to remove, never setup-owned) makes the copy visibly
      // provisional instead of silently passing as "done and correct."
      existing =
        `<!-- contextus: this file was auto-seeded from ${seedFrom} by /contextus-setup ` +
        `on ${new Date().toISOString().slice(0, 10)}. It's a mechanical copy, not a ` +
        `reviewed one — check for ${seedFrom === 'CLAUDE.md' ? 'Claude Code' : 'Muse'}-specific ` +
        `terminology (skill/hook/tool names, slash-command syntax) that may not carry over ` +
        `correctly, then remove this comment. -->\n\n` +
        removeStanza(seedContent);
      seeded = true;
    }
  }

  const { content, changed } = upsertStanza(existing, body);
  if (changed) fs.writeFileSync(filePath, content);
  return { created, changed: changed || created, seeded };
}

/**
 * Reconcile the OTHER host's rules file, if it already exists: re-upsert
 * ITS OWN canonical stanza (its own host-specific body) in place, touching
 * nothing outside the markers. Never creates the sibling — that's
 * writeStanza's first-create seeding path, and only for the host that was
 * actually invoked.
 *
 * Why this exists: seeding on first create isn't enough once both files
 * already exist. Each stanza is only refreshed to the current template when
 * setup runs FOR that specific host — so a project onboarded to both hosts
 * drifts apart over time as the shared template text evolves and each file
 * gets refreshed on a different cadence (or never, for whichever host
 * nobody re-runs setup against). Verified live on this exact repo
 * (2026-11-01): CLAUDE.md's and AGENTS.md's stanzas had each quietly lost a
 * paragraph the other still had. Running setup for either host now
 * converges BOTH files to canonical on every run, rather than only ever
 * touching the one the command targeted.
 */
function reconcileSiblingStanza(
  root: string,
  host: SetupHost
): { file: string; changed: boolean } | null {
  const siblingHost: SetupHost = host === 'muse' ? 'claude' : 'muse';
  const { file, body } = HOST_STANZA[siblingHost];
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) return null;
  const existing = fs.readFileSync(filePath, 'utf8');
  const { content, changed } = upsertStanza(existing, body);
  if (changed) fs.writeFileSync(filePath, content);
  return { file, changed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const project = path.basename(args.dir);

  console.log(`contextus setup — ${args.dir}\n`);

  // 1. Scaffold the context dir + index.
  const scaffold = scaffoldContextDir(args.dir);
  console.log(
    `  .claude/context/   ${scaffold.createdDir ? 'created' : 'already present'}` +
      (scaffold.createdIndex ? ' (+ starter CONTEXT.md)' : '')
  );

  // 2. Upsert the host rules-file stanza (the only file we edit; idempotent).
  const rulesFile = HOST_STANZA[args.host].file;
  const before = fs.existsSync(path.join(args.dir, rulesFile))
    ? hasStanza(fs.readFileSync(path.join(args.dir, rulesFile), 'utf8'))
    : false;
  const stanza = writeStanza(args.dir, args.host);
  console.log(
    `  ${rulesFile} stanza   ${
      before ? 'updated in place (no duplicate)' : stanza.created ? `created ${rulesFile}` : 'added'
    }` + (stanza.seeded ? ' — seeded from sibling, needs a review pass (see flag comment)' : '')
  );

  // 2b. Reconcile the sibling rules file's stanza too, if it already
  // exists — keeps both files converging on every run instead of drifting
  // apart between whichever host each one was last set up against.
  const sibling = reconcileSiblingStanza(args.dir, args.host);
  if (sibling) {
    console.log(
      `  ${sibling.file} stanza   ${sibling.changed ? 'reconciled to canonical' : 'already in sync'}`
    );
  }

  // 3. Ensure the daemon: reuse a healthy one (any location — reuse wins
  // over code path, version drift only warns), else sync the neutral home,
  // start it, and verify /health. Throws on failure: setup must fail loudly
  // here, never limp on with a dead daemon (the silent-fail-open §3 exists
  // to prevent). Daemon start is a setup cost, never a hook cost.
  await ensureDaemonReady();

  // 4. Initial embed (reconcile from the context files). Skippable via --no-embed.
  if (args.embed) {
    const ctxDir = path.join(args.dir, '.claude', 'context');
    try {
      const r = await runReconcile(ctxDir, project);
      if (r.state === 'empty') {
        console.log(
          '  embed              skipped (no context files yet — add some, then /rebuild)'
        );
      } else {
        const total = (await tableExists(project)) ? await countRows(project) : 0;
        console.log(
          `  embed              ${r.embedded} embedded, ${r.removed} removed → ${total} rows total`
        );
      }
    } catch (err) {
      console.log(
        `  embed              FAILED (${err instanceof Error ? err.message : String(err)})`
      );
      console.log('                     is the daemon/Ollama up? try: pnpm run embed');
    }
  } else {
    console.log('  embed              skipped (--no-embed)');
  }

  // 4b. One-time transcript-mining bootstrap scan (only when the skill passed
  // --mine-transcripts, i.e. the user said yes when asked). Same extraction
  // pipeline the recurring SessionStart trigger uses (GH issue #39) — this is
  // just the FIRST scan, matching decision-transcript-mining-recurring.md's
  // "Relationship to Setup" (setup bootstraps ~1 week, recurring picks up
  // from there). Never runs unasked — real LLM cost/time per session window.
  if (args.mineTranscripts) {
    try {
      const r = await mineProject(args.dir, {
        all: false,
        dryRun: false,
        list: false,
        help: false,
        since: '7d'
      });
      console.log(
        `  transcript mining  ${r.extracted} pattern(s) extracted from ${r.sessions} session(s) (last 7 days)`
      );
    } catch (err) {
      console.log(
        `  transcript mining  FAILED (${err instanceof Error ? err.message : String(err)})`
      );
      console.log('                     is the daemon up? try: pnpm mine-transcripts --dry-run');
    }
  }

  // 5. Config tuning via floor calibration (--tune or if prompted)
  if (args.tune) {
    console.log('\n── Config Tuning ──');
    try {
      const outcome = await runFloorReplay({ project }, (msg) => console.log(`  ${msg}`));
      const cfg = loadConfig();
      printFloorReport(outcome, cfg.retrieval.injectionFloor);

      const rec = outcome.recommendation;
      const proposals: Record<string, unknown> = {
        'retrieval.injectionFloor': rec.recommendedFloor
      };
      // Set expansion threshold slightly above floor (covers the gap)
      if (rec.recommendedFloor > 0) {
        proposals['expansion.expansionThreshold'] = Math.min(
          0.95,
          Math.round((rec.recommendedFloor + 0.05) * 100) / 100
        );
      }

      const configPath = projectLocalConfigPath(project);
      const changes = buildChanges(proposals, configPath);
      if (hasRealChanges(changes)) {
        console.log('\n  Proposed config changes (per-project):');
        console.log(renderDiff(changes));
        console.log(`\n  Target: ${configPath}`);
        console.log('  To apply: /context-calibrate --floor --apply');
        console.log('  Or re-run: /contextus-setup --tune (with manual --apply in calibrate)');
      } else {
        console.log('  Config already matches the recommendation — no changes needed.');
      }
    } catch (err) {
      if (err instanceof ReplayError) {
        console.log(`  ⚠ ${err.message}`);
        console.log('    (tune requires real typed prompts — use the project for a week first)');
      } else {
        console.log(`  ⚠ Tuning failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // 6. Stamp completion so the Muse SessionStart hook can tell "setup ran"
  // from "setup never ran". Written for both hosts; only the Muse hook reads
  // it today. A stamp never silences a dead daemon (the hook checks /health).
  const stamp = writeSetupStamp(args.dir, { host: args.host });
  console.log(
    `  setup stamp      ${stamp ? `.claude/setup.json (${args.host})` : 'FAILED to write'}`
  );

  console.log('\n✓ Setup complete. Context will be injected automatically on your next prompts.');
  if (!args.tune) {
    console.log(
      '  Next: /create-context to capture your first pattern, or /context-status to check health.'
    );
    console.log('  Tune: /contextus-setup --tune (after ~a week of use) to calibrate thresholds.');
  }
}

main().catch((err) => {
  console.error('\n✗ contextus-setup failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
