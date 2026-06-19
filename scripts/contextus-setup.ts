#!/usr/bin/env node
/**
 * contextus-setup — the EXPLICIT half of first-run onboarding (the skill engine).
 *
 * This is the ONLY thing in the system that edits CLAUDE.md. A hook must never
 * auto-edit an outward-facing, user-owned file (first-run-onboarding memory); the
 * cheap invisible corpus embed may be automatic (session-start auto-reconcile),
 * but the visible file edit is opt-in and lives here, behind a marked block.
 *
 * What it does, all idempotent:
 *   1. Scaffold `.claude/context/` + a starter `CONTEXT.md` index if absent.
 *   2. Upsert a marked, idempotent contextus stanza into the project CLAUDE.md
 *      (<!-- contextus:start --> … <!-- contextus:end -->) — re-running updates
 *      in place, never duplicates.
 *   3. Run the initial embed (reconcile the corpus from the context files).
 *   4. Confirm the daemon is reachable; print status.
 *
 * Usage:
 *   pnpm contextus-setup                 # set up the current project (cwd)
 *   pnpm contextus-setup --dir <path>    # set up a specific project root
 *   pnpm contextus-setup --no-embed      # scaffold + stanza only, skip embedding
 */

import fs from 'fs';
import path from 'path';
import { upsertStanza, hasStanza } from '../lib/capture/claude-md-stanza.js';
import { runReconcile } from '../lib/embedding/reconcile-run.js';
import { tableExists, countRows } from '../lib/storage/lance-client.js';
import { runFloorReplay, ReplayError } from '../lib/calibration/floor-replay.js';
import { printFloorReport } from '../lib/calibration/floor-report.js';
import { buildChanges, renderDiff, hasRealChanges } from '../lib/calibration/config-write.js';
import { loadConfig, projectLocalConfigPath } from '../lib/config.js';

interface Args {
  dir: string;
  embed: boolean;
  tune: boolean;
}

function parseArgs(argv: string[]): Args {
  let dir = process.cwd();
  let embed = true;
  let tune = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else if (argv[i] === '--no-embed') embed = false;
    else if (argv[i] === '--tune') tune = true;
  }
  return { dir, embed, tune };
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

/** Upsert the stanza into CLAUDE.md (creating the file if absent). */
function writeStanza(root: string): { created: boolean; changed: boolean } {
  const file = path.join(root, 'CLAUDE.md');
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const created = existing === '';
  const { content, changed } = upsertStanza(existing);
  if (changed) fs.writeFileSync(file, content);
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

  // 2. Upsert the CLAUDE.md stanza (the only file we edit; idempotent).
  const before = fs.existsSync(path.join(args.dir, 'CLAUDE.md'))
    ? hasStanza(fs.readFileSync(path.join(args.dir, 'CLAUDE.md'), 'utf8'))
    : false;
  const stanza = writeStanza(args.dir);
  console.log(
    `  CLAUDE.md stanza   ${
      before ? 'updated in place (no duplicate)' : stanza.created ? 'created CLAUDE.md' : 'added'
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
