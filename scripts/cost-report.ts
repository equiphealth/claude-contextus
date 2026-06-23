#!/usr/bin/env node
/**
 * Token cost report — honest overhead numbers for org defensibility.
 *
 * Parses usage.jsonl to answer "how much extra are we spending on context
 * injection?" paired with "what did we get for it?". Framing: cost (extra
 * tokens) ÷ value (usage rate from calibration evals).
 *
 * Usage:
 *   npx tsx scripts/cost-report.ts [--project <name>] [--days <N>] [--json]
 *
 * Invoked by /context-status --cost (the skill runs this and reports the output).
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome } from '../lib/config.js';

const LOG_DIR = process.env.CONTEXTUS_LOG_DIR || expandHome('~/.contextus/logs');
const USAGE_PATH = path.join(LOG_DIR, 'usage.jsonl');

interface RetrievalEvent {
  type: 'retrieval';
  timestamp: string;
  project: string;
  tokens_injected: number;
  retrieved: string[];
  similarity_scores?: number[];
  reason?: string;
}

interface CalibrationEvent {
  type: 'calibration_eval';
  timestamp: string;
  project: string;
  weighted_score: number;
  evaluations: Array<{ pattern: string; rating: string }>;
}

type UsageEvent = RetrievalEvent | CalibrationEvent;

function printHelp(): void {
  console.log(`cost-report — Token overhead numbers for org defensibility

Usage:
  pnpm cost-report [options]

Options:
  --project <name>   Filter to a single project (default: all projects)
  --days <N>         Time window in days (default: 30)
  --json             Machine-readable JSON output
  --help             Show this help message

Examples:
  pnpm cost-report
  pnpm cost-report --project automation --days 7
  pnpm cost-report --json`);
}

function parseArgs(): { project?: string; days: number; json: boolean } {
  const args = process.argv.slice(2);
  let project: string | undefined;
  let days = 30;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
    if (args[i] === '--project' && args[i + 1]) {
      project = args[++i];
    } else if (args[i] === '--days' && args[i + 1]) {
      days = parseInt(args[++i], 10) || 30;
    } else if (args[i] === '--json') {
      json = true;
    }
  }
  return { project, days, json };
}

function loadEvents(project?: string, days?: number): UsageEvent[] {
  if (!fs.existsSync(USAGE_PATH)) return [];

  const cutoff = days ? new Date(Date.now() - days * 86400_000).toISOString() : undefined;
  const lines = fs.readFileSync(USAGE_PATH, 'utf8').split('\n').filter(Boolean);
  const events: UsageEvent[] = [];

  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (cutoff && e.timestamp < cutoff) continue;
      if (project && e.project !== project) continue;
      if (e.type === 'retrieval' || e.type === 'calibration_eval') {
        events.push(e);
      }
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

interface CostReport {
  period: { days: number; from: string; to: string };
  project: string;
  queries: {
    total: number;
    injected: number;
    skipped: number;
    injectionRate: number;
  };
  tokens: {
    totalInjectedTokens: number;
    avgInjectionSize: number;
    dailyRunRate: number;
  };
  quality: {
    hasCalibration: boolean;
    avgWeightedScore: number | null;
    evalCount: number;
    usageRatings: Record<string, number>;
  };
  costValue: {
    valueSignal: string;
    summary: string;
  };
}

function computeReport(events: UsageEvent[], project: string, days: number): CostReport {
  const retrievals = events.filter((e): e is RetrievalEvent => e.type === 'retrieval');
  // Only count calibration evals from projects that had real retrieval traffic —
  // test-project evals (e.g. "demo") leak into the log and shouldn't pollute the value signal.
  const realProjects = new Set(retrievals.map((e) => e.project));
  const evals = events.filter(
    (e): e is CalibrationEvent => e.type === 'calibration_eval' && realProjects.has(e.project)
  );

  const injected = retrievals.filter((e) => e.retrieved.length > 0);
  const skipped = retrievals.filter((e) => e.retrieved.length === 0);

  const totalInjectedTokens = retrievals.reduce((sum, e) => sum + e.tokens_injected, 0);
  const avgInjectionSize =
    injected.length > 0 ? Math.round(totalInjectedTokens / injected.length) : 0;
  const dailyRunRate = days > 0 ? Math.round(totalInjectedTokens / days) : totalInjectedTokens;

  // Quality from calibration evals
  const hasCalibration = evals.length > 0;
  const avgWeightedScore = hasCalibration
    ? Number((evals.reduce((sum, e) => sum + e.weighted_score, 0) / evals.length).toFixed(3))
    : null;

  // Tally ratings across all evals
  const usageRatings: Record<string, number> = {};
  for (const ev of evals) {
    for (const r of ev.evaluations) {
      usageRatings[r.rating] = (usageRatings[r.rating] ?? 0) + 1;
    }
  }

  // Value framing
  let valueSignal: string;
  if (!hasCalibration) {
    valueSignal = 'unknown (run /context-calibrate to measure)';
  } else if (avgWeightedScore! >= 0.7) {
    valueSignal = `strong (${(avgWeightedScore! * 100).toFixed(0)}% weighted usage score)`;
  } else if (avgWeightedScore! >= 0.4) {
    valueSignal = `moderate (${(avgWeightedScore! * 100).toFixed(0)}% weighted usage score)`;
  } else {
    valueSignal = `weak (${(avgWeightedScore! * 100).toFixed(0)}% weighted usage score)`;
  }

  let summary: string;
  if (!hasCalibration) {
    summary = `${totalInjectedTokens.toLocaleString()} tokens injected (~${dailyRunRate.toLocaleString()}/day). Run /context-calibrate to quantify the value side.`;
  } else {
    summary = `${totalInjectedTokens.toLocaleString()} tokens injected (~${dailyRunRate.toLocaleString()}/day) with ${valueSignal} value signal.`;
  }

  const now = new Date();
  const from = new Date(now.getTime() - days * 86400_000);

  return {
    period: {
      days,
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10)
    },
    project: project || 'all',
    queries: {
      total: retrievals.length,
      injected: injected.length,
      skipped: skipped.length,
      injectionRate:
        retrievals.length > 0 ? Number(((injected.length / retrievals.length) * 100).toFixed(1)) : 0
    },
    tokens: {
      totalInjectedTokens,
      avgInjectionSize,
      dailyRunRate
    },
    quality: {
      hasCalibration,
      avgWeightedScore,
      evalCount: evals.length,
      usageRatings
    },
    costValue: {
      valueSignal,
      summary
    }
  };
}

function formatHuman(report: CostReport): string {
  const lines: string[] = [];
  lines.push(`Token Cost Report (${report.period.from} → ${report.period.to})`);
  lines.push(`Project: ${report.project}`);
  lines.push('');

  lines.push('Queries:');
  lines.push(`  Total:           ${report.queries.total}`);
  lines.push(`  Injected:        ${report.queries.injected} (${report.queries.injectionRate}%)`);
  lines.push(`  Skipped (floor): ${report.queries.skipped}`);
  lines.push('');

  lines.push('Injection Cost:');
  lines.push(`  Total tokens:    ${report.tokens.totalInjectedTokens.toLocaleString()}`);
  lines.push(`  Avg per query:   ${report.tokens.avgInjectionSize} tokens`);
  lines.push(`  Daily run rate:  ~${report.tokens.dailyRunRate.toLocaleString()} tokens/day`);
  lines.push('');

  lines.push('Value Signal:');
  if (!report.quality.hasCalibration) {
    lines.push('  No calibration data — run /context-calibrate to measure retrieval quality');
  } else {
    lines.push(`  Calibration evals:  ${report.quality.evalCount}`);
    lines.push(
      `  Weighted score:     ${((report.quality.avgWeightedScore ?? 0) * 100).toFixed(0)}%`
    );
    if (Object.keys(report.quality.usageRatings).length > 0) {
      lines.push('  Usage ratings:');
      for (const [rating, count] of Object.entries(report.quality.usageRatings).sort(
        (a, b) => b[1] - a[1]
      )) {
        lines.push(`    ${rating}: ${count}`);
      }
    }
  }
  lines.push('');

  lines.push('Bottom Line:');
  lines.push(`  ${report.costValue.summary}`);

  return lines.join('\n');
}

function main(): void {
  const { project, days, json } = parseArgs();
  const events = loadEvents(project, days);

  if (events.length === 0) {
    if (json) {
      console.log(JSON.stringify({ error: 'no_data', message: 'No usage data found' }));
    } else {
      console.log('No usage data found. Contextus needs to process some queries first.');
    }
    process.exit(0);
  }

  const report = computeReport(events, project ?? 'all', days);

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatHuman(report));
  }
}

main();
