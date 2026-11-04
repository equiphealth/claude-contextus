#!/usr/bin/env node
/**
 * Context stats CLI — usage analytics from usage-ratings.jsonl
 *
 * Usage:
 *   npx tsx scripts/cli/context-stats.ts [--project <name>] [--window 30] [--json] [--cost]
 *
 * Aggregates usage evaluation data to show:
 * - Most useful patterns (high weighted score)
 * - Never retrieved patterns (stale candidates)
 * - Noisy patterns (high retrieval, low usage)
 * - Cost breakdown (eval spend)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectHash } from '../../lib/config.js';

const HOME = os.homedir();
const CONTEXTUS_DATA = path.join(HOME, '.contextus', 'data');
const REGISTRY_PATH = path.join(CONTEXTUS_DATA, 'projects.json');
const USAGE_LOG_PATH = path.join(HOME, '.contextus', 'logs', 'usage.jsonl');

type Rating = 'critical' | 'helpful' | 'mentioned' | 'somewhat-helpful' | 'unused';

interface PatternStats {
  filename: string;
  category: string;
  retrievalCount: number;
  evalCount: number;
  ratings: {
    critical: number;
    helpful: number;
    mentioned: number;
    'somewhat-helpful': number;
    unused: number;
  };
  avgWeightedScore: number;
  lastRetrieved: string | null;
  lastRating: Rating | null;
}

interface UsageRating {
  timestamp: string;
  promptHash: string;
  evaluations: Array<{
    pattern: string;
    rating: Rating;
    similarity: number;
  }>;
  weightedScore: number;
  evalLatencyMs: number;
  evalModel: string;
}

interface RetrievalEvent {
  type: 'retrieval';
  timestamp: string;
  project: string;
  retrieved: string[];
}

/** Resolve a --project value (name, hash, or path) to a projectId hash. */
function resolveProject(input: string): string {
  try {
    const reg: Record<string, { path: string; name: string }> = JSON.parse(
      fs.readFileSync(REGISTRY_PATH, 'utf-8')
    );
    // Direct hash
    if (reg[input]) return input;
    // Name lookup (case-insensitive)
    const lower = input.toLowerCase();
    for (const [hash, entry] of Object.entries(reg)) {
      if (entry.name.toLowerCase() === lower) return hash;
    }
    // Path lookup
    const resolved = path.resolve(input);
    for (const [hash, entry] of Object.entries(reg)) {
      if (entry.path === resolved) return hash;
    }
  } catch {
    /* registry not found — fall through */
  }
  // Fallback: treat as path and compute hash
  if (fs.existsSync(input)) {
    return projectHash(input);
  }
  return input;
}

/** Look up the friendly name for a hash (returns hash if unknown). */
function friendlyName(hash: string): string {
  try {
    const reg: Record<string, { name: string }> = JSON.parse(
      fs.readFileSync(REGISTRY_PATH, 'utf-8')
    );
    return reg[hash]?.name ?? hash;
  } catch {
    return hash;
  }
}

/** Get corpus metadata for a project. */
function getCorpusMetadata(projectId: string): {
  totalFiles: number;
  contextPath: string | null;
  lastEmbedded: string | null;
} {
  try {
    const reg: Record<string, { path: string }> = JSON.parse(
      fs.readFileSync(REGISTRY_PATH, 'utf-8')
    );
    const projectPath = reg[projectId]?.path;
    if (!projectPath) return { totalFiles: 0, contextPath: null, lastEmbedded: null };

    const contextPath = path.join(projectPath, '.claude', 'context');
    if (!fs.existsSync(contextPath)) return { totalFiles: 0, contextPath, lastEmbedded: null };

    // Count .md files recursively
    const countFiles = (dir: string): number => {
      let count = 0;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          count += countFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          count++;
        }
      }
      return count;
    };

    const totalFiles = countFiles(contextPath);

    // Get last embedded timestamp from LanceDB metadata (if available)
    const dbPath = path.join(CONTEXTUS_DATA, projectId, 'lancedb');
    let lastEmbedded: string | null = null;
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      lastEmbedded = new Date(stats.mtime).toISOString().split('T')[0];
    }

    return { totalFiles, contextPath, lastEmbedded };
  } catch {
    return { totalFiles: 0, contextPath: null, lastEmbedded: null };
  }
}

/** Read usage-ratings.jsonl for a project, filter by time window. */
function readUsageRatings(projectId: string, windowDays: number): UsageRating[] {
  const ratingsPath = path.join(CONTEXTUS_DATA, projectId, 'usage-ratings.jsonl');
  if (!fs.existsSync(ratingsPath)) return [];

  const cutoff = Date.now() - windowDays * 86400000;
  const lines = fs.readFileSync(ratingsPath, 'utf-8').split('\n').filter(Boolean);
  const ratings: UsageRating[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as UsageRating;
      if (new Date(entry.timestamp).getTime() >= cutoff) {
        ratings.push(entry);
      }
    } catch {
      /* skip malformed */
    }
  }

  return ratings;
}

/** Read retrieval events from usage.jsonl, filter by project and window. */
function readRetrievalEvents(projectId: string, windowDays: number): RetrievalEvent[] {
  if (!fs.existsSync(USAGE_LOG_PATH)) return [];

  const cutoff = Date.now() - windowDays * 86400000;
  const lines = fs.readFileSync(USAGE_LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const events: RetrievalEvent[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (
        entry.type === 'retrieval' &&
        entry.project === projectId &&
        new Date(entry.timestamp).getTime() >= cutoff
      ) {
        events.push(entry as RetrievalEvent);
      }
    } catch {
      /* skip malformed */
    }
  }

  return events;
}

/** Aggregate usage ratings into per-pattern stats. */
function aggregateStats(
  ratings: UsageRating[],
  retrievalEvents: RetrievalEvent[]
): Map<string, PatternStats> {
  const stats = new Map<string, PatternStats>();

  // Process ratings
  for (const rating of ratings) {
    for (const evalItem of rating.evaluations) {
      const filename = evalItem.pattern;
      if (!stats.has(filename)) {
        stats.set(filename, {
          filename,
          category: inferCategory(filename),
          retrievalCount: 0,
          evalCount: 0,
          ratings: {
            critical: 0,
            helpful: 0,
            mentioned: 0,
            'somewhat-helpful': 0,
            unused: 0
          },
          avgWeightedScore: 0,
          lastRetrieved: null,
          lastRating: null
        });
      }

      const stat = stats.get(filename)!;
      stat.evalCount++;
      stat.ratings[evalItem.rating]++;
      stat.lastRating = evalItem.rating;
    }
  }

  // Calculate weighted scores (critical=1.0, helpful=0.75, somewhat-helpful=0.5, mentioned=0.25, unused=0)
  for (const stat of stats.values()) {
    const total = stat.evalCount;
    if (total === 0) continue;
    const weighted =
      (stat.ratings.critical * 1.0 +
        stat.ratings.helpful * 0.75 +
        stat.ratings['somewhat-helpful'] * 0.5 +
        stat.ratings.mentioned * 0.25) /
      total;
    stat.avgWeightedScore = Math.round(weighted * 100) / 100;
  }

  // Add retrieval counts and last-seen from retrieval events
  const retrievalCounts = new Map<string, number>();
  const lastSeen = new Map<string, string>();

  for (const event of retrievalEvents) {
    for (const filename of event.retrieved) {
      retrievalCounts.set(filename, (retrievalCounts.get(filename) || 0) + 1);
      const existing = lastSeen.get(filename);
      if (!existing || event.timestamp > existing) {
        lastSeen.set(filename, event.timestamp);
      }
    }
  }

  for (const [filename, count] of retrievalCounts) {
    const stat = stats.get(filename);
    if (stat) {
      stat.retrievalCount = count;
      stat.lastRetrieved = lastSeen.get(filename) || null;
    }
  }

  return stats;
}

/** Infer category from filename (gotcha/gotcha-foo.md → gotcha). */
function inferCategory(filename: string): string {
  const parts = filename.split('/');
  return parts.length > 1 ? parts[0] : 'unknown';
}

/** Format human-readable output. */
function formatOutput(
  projectName: string,
  projectId: string,
  stats: Map<string, PatternStats>,
  ratings: UsageRating[],
  windowDays: number,
  showCost: boolean
): void {
  console.log(`\n## Context Usage Analytics: ${projectName}`);
  console.log(`Window: ${windowDays === Infinity ? 'all time' : `last ${windowDays} days`}\n`);

  // Corpus metadata
  const corpus = getCorpusMetadata(projectId);
  console.log(
    `Corpus: ${corpus.totalFiles} files${corpus.lastEmbedded ? ` (last embedded: ${corpus.lastEmbedded})` : ''}`
  );

  // Summary
  const totalQueries = new Set(ratings.map((r) => r.promptHash)).size;
  const totalEvals = ratings.reduce((sum, r) => sum + r.evaluations.length, 0);
  const avgScore =
    ratings.length > 0
      ? Math.round((ratings.reduce((sum, r) => sum + r.weightedScore, 0) / ratings.length) * 100) /
        100
      : 0;

  console.log(`Total Queries (with injection): ${totalQueries}`);
  console.log(`Total Evaluations: ${totalEvals}`);
  console.log(`Avg Weighted Score: ${avgScore}`);

  if (showCost) {
    const evalCost = totalEvals * 0.0003; // $0.0003 per eval (Haiku estimate)
    console.log(`Estimated Eval Cost: $${evalCost.toFixed(3)}`);
  }

  // Top 10 Most Useful
  const useful = Array.from(stats.values())
    .filter((s) => s.evalCount >= 5)
    .sort((a, b) => b.avgWeightedScore - a.avgWeightedScore)
    .slice(0, 10);

  if (useful.length > 0) {
    console.log(`\n## Top ${useful.length} Most Useful (min 5 evals)\n`);
    console.log(
      `${'File'.padEnd(50)} ${'Category'.padEnd(12)} ${'Retrieved'.padEnd(10)} ${'Score'.padEnd(6)} ${'Critical%'.padEnd(10)}`
    );
    console.log('-'.repeat(90));

    for (const stat of useful) {
      const critPct =
        stat.evalCount > 0 ? Math.round((stat.ratings.critical / stat.evalCount) * 100) : 0;
      const filename = stat.filename.length > 48 ? '...' + stat.filename.slice(-45) : stat.filename;
      console.log(
        `${filename.padEnd(50)} ${stat.category.padEnd(12)} ${String(stat.retrievalCount).padEnd(10)} ${stat.avgWeightedScore.toFixed(2).padEnd(6)} ${critPct}%`
      );
    }
  }

  // Noisy patterns (high retrieval, low usage)
  const noisy = Array.from(stats.values())
    .filter((s) => s.retrievalCount >= 10 && s.avgWeightedScore < 0.3)
    .sort((a, b) => b.retrievalCount - a.retrievalCount)
    .slice(0, 10);

  if (noisy.length > 0) {
    console.log(`\n## Noisy Patterns (retrieved 10+ times, avg score < 0.3)\n`);
    console.log(
      `${'File'.padEnd(50)} ${'Category'.padEnd(12)} ${'Retrieved'.padEnd(10)} ${'Score'.padEnd(6)}`
    );
    console.log('-'.repeat(80));

    for (const stat of noisy) {
      const filename = stat.filename.length > 48 ? '...' + stat.filename.slice(-45) : stat.filename;
      console.log(
        `${filename.padEnd(50)} ${stat.category.padEnd(12)} ${String(stat.retrievalCount).padEnd(10)} ${stat.avgWeightedScore.toFixed(2).padEnd(6)}`
      );
    }
  }

  console.log(); // trailing newline
}

/** Format JSON output. */
function formatJson(
  projectName: string,
  projectId: string,
  stats: Map<string, PatternStats>,
  ratings: UsageRating[],
  windowDays: number
): void {
  const totalQueries = new Set(ratings.map((r) => r.promptHash)).size;
  const totalEvals = ratings.reduce((sum, r) => sum + r.evaluations.length, 0);
  const avgScore =
    ratings.length > 0 ? ratings.reduce((sum, r) => sum + r.weightedScore, 0) / ratings.length : 0;

  const corpus = getCorpusMetadata(projectId);

  const output = {
    project: projectName,
    windowDays: windowDays === Infinity ? null : windowDays,
    corpus: {
      totalFiles: corpus.totalFiles,
      lastEmbedded: corpus.lastEmbedded
    },
    summary: {
      totalQueries,
      totalEvaluations: totalEvals,
      avgWeightedScore: Math.round(avgScore * 100) / 100,
      estimatedCost: totalEvals * 0.0003
    },
    patterns: Array.from(stats.values())
  };

  console.log(JSON.stringify(output, null, 2));
}

function printHelp(): void {
  console.log(`context-stats — Usage analytics for injected context

Usage:
  context-stats [options]

Options:
  --project <name>   Target project (name, hash, or path). Defaults to cwd.
  --window N         Days of history to analyze (default: 30)
  --all              Analyze all history (no time window)
  --json             Output JSON instead of human-readable format
  --cost             Include cost breakdown in output
  --help             Show this help

Examples:
  context-stats                              # Current project, last 30 days
  context-stats --project automation         # Named project
  context-stats --window 7 --cost            # Last 7 days with cost
  context-stats --all --json                 # Full history as JSON
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Parse flags
  let projectInput: string | null = null;
  let windowDays = 30;
  let jsonOutput = false;
  let showCost = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--project' && i + 1 < args.length) {
      projectInput = args[++i];
    } else if (arg === '--window' && i + 1 < args.length) {
      windowDays = parseInt(args[++i], 10);
    } else if (arg === '--all') {
      windowDays = Infinity;
    } else if (arg === '--json') {
      jsonOutput = true;
    } else if (arg === '--cost') {
      showCost = true;
    }
  }

  // Resolve project
  const projectId = projectInput ? resolveProject(projectInput) : projectHash(process.cwd());
  const projectName = friendlyName(projectId);

  // Read data
  const ratings = readUsageRatings(projectId, windowDays);
  const retrievalEvents = readRetrievalEvents(projectId, windowDays);

  if (ratings.length === 0) {
    console.error(
      `No usage data found for project "${projectName}". Usage evaluation may be disabled or no context has been injected yet.`
    );
    process.exit(1);
  }

  // Aggregate stats
  const stats = aggregateStats(ratings, retrievalEvents);

  // Output
  if (jsonOutput) {
    formatJson(projectName, projectId, stats, ratings, windowDays);
  } else {
    formatOutput(projectName, projectId, stats, ratings, windowDays, showCost);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
