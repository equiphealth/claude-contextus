#!/usr/bin/env node
/**
 * usage-rate — "Context was used in XX% of responses where it was injected"
 *
 * Reads usage_signal events from usage.jsonl and computes the aggregate
 * usage rate. Optionally filter by project or time window.
 *
 * Usage:
 *   pnpm usage-rate                     # all projects, all time
 *   pnpm usage-rate --project foo       # single project
 *   pnpm usage-rate --days 7            # last 7 days
 *   pnpm usage-rate --json              # machine-readable output
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const USAGE_PATH = path.join(os.homedir(), '.contextus', 'logs', 'usage.jsonl');

interface UsageEvent {
  type: string;
  timestamp: string;
  project: string;
  prompt_hash: string;
  injected: string[];
  used: string[];
  usage_rate: number;
}

interface Args {
  project?: string;
  days?: number;
  json: boolean;
}

function printHelp(): void {
  console.log(`usage-rate — "Context was used in XX% of injected responses"

Usage:
  pnpm usage-rate [options]

Options:
  --project <name>   Filter to a single project (default: all projects)
  --days <N>         Only include the last N days (default: all time)
  --json             Machine-readable JSON output
  --help             Show this help message

Examples:
  pnpm usage-rate
  pnpm usage-rate --project automation --days 7
  pnpm usage-rate --json`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      printHelp();
      process.exit(0);
    }
    if (argv[i] === '--project' && argv[i + 1]) args.project = argv[++i];
    else if (argv[i] === '--days' && argv[i + 1]) args.days = parseInt(argv[++i], 10);
    else if (argv[i] === '--json') args.json = true;
  }
  return args;
}

function loadEvents(args: Args): UsageEvent[] {
  if (!fs.existsSync(USAGE_PATH)) return [];

  const cutoff = args.days ? new Date(Date.now() - args.days * 86400_000).toISOString() : undefined;

  const lines = fs.readFileSync(USAGE_PATH, 'utf-8').split('\n').filter(Boolean);
  const events: UsageEvent[] = [];

  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (e.type !== 'usage_signal') continue;
      if (args.project && e.project !== args.project) continue;
      if (cutoff && e.timestamp < cutoff) continue;
      events.push(e);
    } catch {
      continue;
    }
  }
  return events;
}

interface PatternStats {
  injectedCount: number;
  usedCount: number;
  rate: number;
}

function computePatternBreakdown(events: UsageEvent[]): Map<string, PatternStats> {
  const stats = new Map<string, PatternStats>();
  for (const e of events) {
    const usedSet = new Set(e.used);
    for (const p of e.injected) {
      const s = stats.get(p) || { injectedCount: 0, usedCount: 0, rate: 0 };
      s.injectedCount++;
      if (usedSet.has(p)) s.usedCount++;
      s.rate = s.injectedCount > 0 ? s.usedCount / s.injectedCount : 0;
      stats.set(p, s);
    }
  }
  return stats;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const events = loadEvents(args);

  if (events.length === 0) {
    if (args.json) {
      console.log(JSON.stringify({ error: 'no_data', events: 0 }));
    } else {
      console.log('No usage signal data yet.');
      console.log(
        'The Stop hook logs this automatically — use contextus for a bit and check back.'
      );
    }
    return;
  }

  // Headline: responses where at least one pattern was used / total responses
  const responsesWithUsage = events.filter((e) => e.used.length > 0).length;
  const totalResponses = events.length;
  const headlineRate = responsesWithUsage / totalResponses;

  // Per-pattern: how often each pattern is used when injected
  const patternStats = computePatternBreakdown(events);
  const sorted = [...patternStats.entries()].sort((a, b) => b[1].usedCount - a[1].usedCount);

  // Average per-injection usage (what % of injected patterns were used per response)
  const avgPerInjectionRate = events.reduce((sum, e) => sum + e.usage_rate, 0) / events.length;

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          headlineRate: Math.round(headlineRate * 100),
          avgPerInjectionRate: Math.round(avgPerInjectionRate * 100),
          totalResponses,
          responsesWithUsage,
          topPatterns: sorted.slice(0, 10).map(([name, s]) => ({
            pattern: name,
            injected: s.injectedCount,
            used: s.usedCount,
            rate: Math.round(s.rate * 100)
          })),
          ...(args.project ? { project: args.project } : {}),
          ...(args.days ? { days: args.days } : {})
        },
        null,
        2
      )
    );
    return;
  }

  // Human output
  const scope = [
    args.project ? `project: ${args.project}` : 'all projects',
    args.days ? `last ${args.days} days` : 'all time'
  ].join(', ');

  console.log(`\nUsage Rate Report (${scope})\n`);
  console.log(`  Context used in ${Math.round(headlineRate * 100)}% of injected responses`);
  console.log(
    `  (${responsesWithUsage} of ${totalResponses} responses referenced at least one pattern)\n`
  );
  console.log(
    `  Avg patterns used per response: ${Math.round(avgPerInjectionRate * 100)}% of injected\n`
  );

  if (sorted.length > 0) {
    console.log('  Top patterns (by usage count):');
    const top = sorted.slice(0, 10);
    const maxName = Math.max(...top.map(([n]) => n.length), 7);
    console.log(`  ${'Pattern'.padEnd(maxName)}  Used  Injected  Rate`);
    for (const [name, s] of top) {
      console.log(
        `  ${name.padEnd(maxName)}  ${String(s.usedCount).padStart(4)}  ${String(s.injectedCount).padStart(8)}  ${Math.round(s.rate * 100)}%`
      );
    }
  }

  // Bottom patterns (injected often but rarely used — candidates for removal)
  const bottom = sorted
    .filter(([, s]) => s.injectedCount >= 3)
    .sort((a, b) => a[1].rate - b[1].rate)
    .slice(0, 5);

  if (bottom.length > 0 && bottom[0][1].rate < 0.3) {
    console.log('\n  Low-value patterns (injected 3+ times, rarely used):');
    for (const [name, s] of bottom) {
      if (s.rate >= 0.3) break;
      console.log(
        `  ⚠ ${name} — used ${Math.round(s.rate * 100)}% (${s.usedCount}/${s.injectedCount})`
      );
    }
  }

  console.log('');
}

main();
