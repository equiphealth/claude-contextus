#!/usr/bin/env node
/**
 * /context-calibrate — the single front door for BOTH floor-calibration signals
 * (calibration-two-signals memory), with one shared apply path.
 *
 *   1. Cold-start floor-replay  (--floor)   — replay real historical prompts,
 *      recommend an injection floor from the similarity distribution. Works with
 *      zero usage history. Engine: lib/calibration/floor-replay.ts (same as the
 *      `pnpm calibrate-floor` dev CLI).
 *   2. Usage-eval refinement    (--start/--status/--report/--stop) — run a Haiku
 *      grading campaign over real injections, then recommend knobs from whether
 *      patterns were actually USED. Needs accumulated usage.
 *
 * Both write through lib/calibration/config-write.ts (--diff shows, --apply
 * writes). The clean lifecycle: floor-replay sets the cold-start floor → usage-eval
 * refines it once real usage accumulates.
 *
 * Usage:
 *   /context-calibrate --floor              # replay → recommend a floor (print only)
 *   /context-calibrate --floor --diff       # show the plugin.json diff it would make
 *   /context-calibrate --floor --apply      # write config.retrieval.injectionFloor
 *   /context-calibrate --start [--samples N]# begin a usage-eval campaign
 *   /context-calibrate --status             # campaign progress
 *   /context-calibrate --report             # aggregate quality from logged evals
 *   /context-calibrate --stop               # cancel the campaign early
 */

import fs from 'node:fs';
import {
  loadProjectConfig,
  projectLocalConfigPath,
  expandHome,
  projectHash
} from '../lib/config.js';
import { runFloorReplay, ReplayError } from '../lib/calibration/floor-replay.js';
import { printFloorReport } from '../lib/calibration/floor-report.js';
import {
  buildChanges,
  renderDiff,
  hasRealChanges,
  applyChanges
} from '../lib/calibration/config-write.js';
import { readState, startCalibration, writeState } from '../lib/calibration/calibration-state.js';
import { RATING_WEIGHTS } from '../lib/calibration/eval-calibration.js';

interface Args {
  floor: boolean;
  diff: boolean;
  apply: boolean;
  start: boolean;
  status: boolean;
  report: boolean;
  stop: boolean;
  project?: string;
  limit?: number;
  samples?: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    floor: false,
    diff: false,
    apply: false,
    start: false,
    status: false,
    report: false,
    stop: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--floor') a.floor = true;
    else if (arg === '--diff') a.diff = true;
    else if (arg === '--apply') a.apply = true;
    else if (arg === '--start') a.start = true;
    else if (arg === '--status') a.status = true;
    else if (arg === '--report') a.report = true;
    else if (arg === '--stop') a.stop = true;
    else if (arg === '--project' && argv[i + 1]) a.project = argv[++i];
    else if (arg === '--limit' && argv[i + 1]) a.limit = Number(argv[++i]);
    else if (arg === '--samples' && argv[i + 1]) a.samples = Number(argv[++i]);
  }
  return a;
}

/* ── Floor-replay path ─────────────────────────────────────────────────────── */

async function runFloorMode(args: Args): Promise<void> {
  // Resolve the project name the same way the replay does (cwd basename unless
  // --project given), so the floor we write is scoped to THIS project's corpus.
  const project = args.project ?? projectHash(process.cwd());
  // PER-PROJECT write target: the machine-local override beside this project's
  // corpus, NOT the global plugin.json — so calibrating one project never changes
  // another's floor (the multi-project unblocker). Diff is read from the same file.
  const target = projectLocalConfigPath(project);
  const cfg = loadProjectConfig(project, process.cwd());
  let outcome;
  try {
    outcome = await runFloorReplay({ project, limit: args.limit }, (msg) => console.error(msg));
  } catch (err) {
    if (err instanceof ReplayError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  printFloorReport(outcome, cfg.retrieval.injectionFloor);

  const recommended = outcome.recommendation.recommendedFloor;
  const changes = buildChanges({ 'retrieval.injectionFloor': recommended }, target);

  // --apply writes; --diff (or plain --floor) shows what WOULD change.
  if (args.apply) {
    if (!hasRealChanges(changes)) {
      console.log(`  Floor already ${recommended} for '${project}' — nothing to write.\n`);
      return;
    }
    const n = applyChanges(changes, target);
    console.log(
      `  ✓ Applied to '${project}': config.retrieval.injectionFloor → ${recommended} (${n} key).`
    );
    console.log(`  Written to ${target} (this project only).`);
    console.log('  Restart the daemon (or it picks up on next cold start) to use the new floor.\n');
    return;
  }

  console.log('  Proposed config change (NOT yet applied):');
  console.log(hasRealChanges(changes) ? renderDiff(changes) : '  (floor already matches)');
  console.log('\n  Eyeball the trade curve above, then:');
  console.log('    /context-calibrate --floor --apply    # write it');
  console.log('══════════════════════════════════════════════════════════\n');
}

/* ── Usage-eval campaign path ──────────────────────────────────────────────── */

function runStart(args: Args): void {
  const state = startCalibration(args.samples ? { targetSamples: args.samples } : {});
  console.log('Contextus calibration started.');
  console.log(`  target: ${state.targetSamples} evaluated retrievals`);
  console.log(
    `  model:  ${state.model.provider}${state.model.model ? ` (${state.model.model})` : ''}`
  );
  console.log('  Claude will rate injected patterns after each response (background).');
  console.log('  Progress: /context-calibrate --status   ·   cancel: /context-calibrate --stop');
}

function runStatus(): void {
  const s = readState();
  if (!s.startedAt) {
    console.log('No calibration campaign has been started. Begin one: /context-calibrate --start');
    return;
  }
  console.log('Contextus calibration status.');
  console.log(`  active:  ${s.evaluateUsage ? 'yes' : 'no (complete or stopped)'}`);
  console.log(`  samples: ${s.sampleCount}/${s.targetSamples}`);
  console.log(`  started: ${s.startedAt}`);
  if (s.completedAt) console.log(`  completed: ${s.completedAt}`);
  if (s.sampleCount > 0) console.log('  Full quality report: /context-calibrate --report');
}

function runStop(): void {
  const s = readState();
  if (!s.evaluateUsage) {
    console.log('No active calibration campaign to stop.');
    return;
  }
  s.evaluateUsage = false;
  s.completedAt = new Date().toISOString();
  writeState(s);
  console.log(`Calibration stopped at ${s.sampleCount}/${s.targetSamples} samples.`);
  if (s.sampleCount > 0) console.log('Partial report: /context-calibrate --report');
}

interface CalibrationEvalRecord {
  type?: string;
  retrieved?: string[];
  evaluations?: Array<{ pattern: string; rating: string }>;
  weighted_score?: number;
}

/** Aggregate logged calibration_eval events into a per-pattern quality report. */
function runReport(): void {
  const usagePath = expandHome('~/.contextus/logs/usage.jsonl');
  if (!fs.existsSync(usagePath)) {
    console.log('No usage log yet — run a campaign first (/context-calibrate --start).');
    return;
  }
  const lines = fs.readFileSync(usagePath, 'utf8').split('\n').filter(Boolean);
  const evals: CalibrationEvalRecord[] = [];
  for (const line of lines) {
    try {
      const o = JSON.parse(line) as CalibrationEvalRecord;
      if (o.type === 'calibration_eval') evals.push(o);
    } catch {
      /* skip malformed lines */
    }
  }
  if (evals.length === 0) {
    console.log(
      'No calibration_eval events logged yet. Start a campaign and use Claude for a while.'
    );
    return;
  }

  // Per-pattern rating tallies + a weighted score.
  const byPattern = new Map<string, Record<string, number>>();
  let totalScore = 0;
  for (const e of evals) {
    totalScore += e.weighted_score ?? 0;
    for (const r of e.evaluations ?? []) {
      const tally = byPattern.get(r.pattern) ?? {
        critical: 0,
        helpful: 0,
        mentioned: 0,
        unused: 0
      };
      if (r.rating in tally) tally[r.rating]++;
      byPattern.set(r.pattern, tally);
    }
  }

  console.log(`Contextus calibration report (${evals.length} evaluated retrievals)`);
  console.log(`  mean weighted score: ${(totalScore / evals.length).toFixed(2)}\n`);
  const rows = [...byPattern.entries()]
    .map(([pattern, t]) => {
      const total = t.critical + t.helpful + t.mentioned + t.unused;
      const score =
        total === 0
          ? 0
          : (t.critical * RATING_WEIGHTS.critical +
              t.helpful * RATING_WEIGHTS.helpful +
              t.mentioned * RATING_WEIGHTS.mentioned) /
            total;
      return { pattern, t, total, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const r of rows) {
    console.log(
      `  ${(r.score * 100).toFixed(0).padStart(3)}%  ${r.pattern}  ` +
        `(crit ${r.t.critical}, help ${r.t.helpful}, ment ${r.t.mentioned}, unused ${r.t.unused})`
    );
  }
  const prune = rows.filter((r) => r.total >= 5 && r.score < 0.2);
  if (prune.length) {
    console.log('\n  Prune candidates (retrieved ≥5×, <20% weighted):');
    for (const r of prune) console.log(`    ⚠ ${r.pattern}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.floor) return runFloorMode(args);
  if (args.start) return runStart(args);
  if (args.stop) return runStop();
  if (args.report) return runReport();
  if (args.status) return runStatus();

  // Bare invocation → show status (or a hint if nothing's running).
  runStatus();
}

main().catch((err) => {
  console.error('context-calibrate failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
