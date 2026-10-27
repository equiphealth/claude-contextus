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
 *   3. Run the initial embed (reconcile the corpus from the context files).
 *   4. Confirm the daemon is reachable; print status.
 *   5. Write the setup-completion stamp the Muse SessionStart hook reads.
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
import {
  upsertStanza,
  hasStanza,
  HOST_STANZA,
  type SetupHost
} from '../lib/capture/claude-md-stanza.js';
import { writeSetupStamp } from './lib/daemon-control.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { tableExists, countRows } from '../lib/storage/lance-client.js';
import { runFloorReplay, ReplayError } from '../lib/calibration/floor-replay.js';
import { printFloorReport } from '../lib/calibration/floor-report.js';
import { buildChanges, renderDiff, hasRealChanges } from '../lib/calibration/config-write.js';
import { loadConfig, projectLocalConfigPath } from '../lib/config.js';
import { mineProject } from './mine-transcripts.js';

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
 */
function writeStanza(root: string, host: SetupHost): { created: boolean; changed: boolean } {
  const { file, body } = HOST_STANZA[host];
  const filePath = path.join(root, file);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const created = existing === '';
  const { content, changed } = upsertStanza(existing, body);
  if (changed) fs.writeFileSync(filePath, content);
  return { created, changed: changed || created };
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
    }`
  );

  // 3. Initial embed (reconcile from the context files). Skippable via --no-embed.
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

  // 3b. One-time transcript-mining bootstrap scan (only when the skill passed
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

  // 4. Config tuning via floor calibration (--tune or if prompted)
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

  // 5. Stamp completion so the Muse SessionStart hook can tell "setup ran"
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
