#!/usr/bin/env node
/**
 * Contextus status CLI — standalone executable that works from any project.
 *
 * Usage:
 *   npx tsx ~/.claude/plugins/contextus/scripts/cli/status.ts [--project <name>]
 *   npx tsx ~/.claude/plugins/contextus/scripts/cli/status.ts --cost [--days 30]
 *
 * This is the actual implementation behind /context-status skill, extracted
 * as a standalone CLI so it works regardless of which Claude model is running.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readVersionState, compareSemver } from '../../lib/version.js';
import { projectHash } from '../../lib/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DAEMON_URL = process.env.CONTEXTUS_DAEMON_URL || 'http://127.0.0.1:37800';
const REGISTRY_PATH = path.join(os.homedir(), '.contextus', 'data', 'projects.json');

/** Resolve a --project value (name, hash, or path) to a projectId hash. */
function resolveProject(input: string): string {
  try {
    const reg: Record<string, { path: string; name: string }> = JSON.parse(
      fs.readFileSync(REGISTRY_PATH, 'utf-8')
    );
    // Direct hash
    if (reg[input]) return input;
    // Name lookup
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

interface IntrospectResponse {
  version: string;
  uptimeSeconds: number;
  modelLoaded: boolean;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    corpusProvider: string;
    corpusModel: string;
  };
  packs: string[];
  corpus: {
    chunks: number;
    byType: Record<string, number>;
    withHits: number;
    totalHits: number;
    topHits: Array<{ id: string; hits: number }>;
  };
  retrieval: {
    topK: number;
    injectionFloor: number;
    similarityThreshold: number;
    maxTokens: number;
  };
  calibration: {
    evaluateUsage: boolean;
    sampleCount: number;
    targetSamples: number;
  };
}

function printHelp() {
  console.log(`contextus status — health dashboard and cost reporting

Usage:
  status [--project <name>]           Show health dashboard
  status --cost [--days N]            Show token cost report

Options:
  --project <hash>   Target projectId hash (default: sha256 of cwd)
  --cost             Show cost report instead of dashboard
  --days <N>         Time window for cost report (default: 30)
  --help             Show this help

Examples:
  status                              # Dashboard for current project
  status --project automation         # Dashboard for specific project
  status --cost                       # Last 30 days cost report
  status --cost --days 7              # Last 7 days cost report
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts: { project?: string; cost?: boolean; days?: number; help?: boolean } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--cost') {
      opts.cost = true;
    } else if (arg === '--project' && i + 1 < args.length) {
      opts.project = args[++i];
    } else if (arg === '--days' && i + 1 < args.length) {
      opts.days = parseInt(args[++i], 10);
    }
  }

  return opts;
}

async function fetchIntrospect(project: string): Promise<IntrospectResponse | null> {
  try {
    const url = `${DAEMON_URL}/introspect?project=${encodeURIComponent(project)}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Daemon returned ${response.status}: ${response.statusText}`);
      return null;
    }
    return (await response.json()) as IntrospectResponse;
  } catch (err) {
    console.error(`Failed to connect to daemon at ${DAEMON_URL}`);
    console.error(`Make sure contextus daemon is running (check /contextus-watch)`);
    return null;
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Scan directory recursively for .md files modified in last N days */
function countRecentFiles(dir: string, days: number): number {
  if (!fs.existsSync(dir)) return 0;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let count = 0;

  const walk = (currentPath: string) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const stat = fs.statSync(fullPath);
        if (stat.mtimeMs > cutoff) {
          count++;
        }
      }
    }
  };

  walk(dir);
  return count;
}

/** Calculate growth metrics for a project */
function calculateGrowth(
  projectPath: string,
  days: number = 30
): { patterns: number; docs: number } {
  const contextDir = path.join(projectPath, '.claude', 'context');
  const docsDir = path.join(projectPath, 'docs');

  return {
    patterns: countRecentFiles(contextDir, days),
    docs: countRecentFiles(docsDir, days)
  };
}

/** Look up project path from registry for growth calculation */
function getProjectPath(projectId: string): string | null {
  try {
    const reg: Record<string, { path: string }> = JSON.parse(
      fs.readFileSync(REGISTRY_PATH, 'utf-8')
    );
    return reg[projectId]?.path ?? null;
  } catch {
    return null;
  }
}

function printDashboard(data: IntrospectResponse, project: string) {
  const display = friendlyName(project);
  console.log(`\nContextus Status — ${display}${display !== project ? ` (${project})` : ''}\n`);

  // Version — daemon's running version (data.version) vs this machine's data
  // schema version (~/.contextus/version.json). The two usually match; a gap
  // means session-start reported an upgrade but /contextus-upgrade hasn't run
  // yet for the breaking-change path (non-breaking bumps self-stamp on report).
  const dataVersion = readVersionState().version;
  const versionLine =
    compareSemver(dataVersion, data.version) < 0
      ? `v${data.version} (data schema v${dataVersion} — run /contextus-upgrade)`
      : `v${data.version}`;
  console.log(`Version: ${versionLine}\n`);

  // Knowledge Base
  console.log('Knowledge Base:');
  console.log(`  🔢 Vector chunks: ${data.corpus.chunks.toLocaleString()}`);
  console.log(`  📦 Packs: ${data.packs.join(', ')}`);

  // Growth tracking (30-day window)
  const projectPath = getProjectPath(project);
  if (projectPath) {
    const growth = calculateGrowth(projectPath, 30);
    console.log(`  📈 Growth (30d): +${growth.patterns} patterns, +${growth.docs} docs`);
  }

  console.log();

  // Corpus Distribution (top 5 types)
  const sortedTypes = Object.entries(data.corpus.byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  console.log('Corpus Distribution:');
  for (const [type, count] of sortedTypes) {
    const pct = ((count / data.corpus.chunks) * 100).toFixed(0);
    console.log(`  ${type.padEnd(15)} ${count.toString().padStart(4)} chunks (${pct}%)`);
  }
  if (Object.keys(data.corpus.byType).length > 5) {
    const remaining = Object.keys(data.corpus.byType).length - 5;
    console.log(`  (+ ${remaining} other types)`);
  }
  console.log();

  // Activity
  console.log('Activity:');
  console.log(`  ✓ Daemon: Running (${formatUptime(data.uptimeSeconds)} uptime)`);
  console.log(
    `  ✓ Model: ${data.embedding.model} loaded (${data.embedding.dimensions} dim, ${data.embedding.provider})`
  );
  const usageRate =
    data.corpus.chunks > 0 ? ((data.corpus.withHits / data.corpus.chunks) * 100).toFixed(0) : 0;
  console.log(
    `  ✓ Patterns used: ${data.corpus.withHits} different (${usageRate}% have been retrieved)`
  );
  console.log(`  ✓ Total retrievals: ${data.corpus.totalHits}`);
  console.log();

  // Top Retrieved
  if (data.corpus.topHits.length > 0) {
    console.log('Top Retrieved:');
    data.corpus.topHits.slice(0, 5).forEach((hit, i) => {
      // Extract filename from id (format: hash:type:path#chunk)
      const match = hit.id.match(/:([^#]+)/);
      const filename = match ? match[1] : hit.id;
      console.log(`  ${i + 1}. ${filename} (${hit.hits} hits)`);
    });
    console.log();
  }

  // Configuration
  console.log('Configuration:');
  console.log(`  topK: ${data.retrieval.topK}`);
  console.log(
    `  injectionFloor: ${data.retrieval.injectionFloor} ${data.retrieval.injectionFloor > 0.7 ? '(strict)' : '(moderate)'}`
  );
  console.log(`  similarityThreshold: ${data.retrieval.similarityThreshold}`);
  console.log(`  maxTokens: ${data.retrieval.maxTokens}`);
  console.log();

  // Calibration
  console.log('Calibration:');
  const evalStatus = data.calibration.evaluateUsage ? 'ACTIVE ✓' : 'OFF';
  console.log(`  Usage evaluation: ${evalStatus}`);
  if (data.calibration.evaluateUsage) {
    console.log(
      `  Samples collected: ${data.calibration.sampleCount} / ${data.calibration.targetSamples} target`
    );
    if (data.calibration.sampleCount < data.calibration.targetSamples) {
      console.log(`  Status: Phase 1 collection in progress`);
    } else {
      console.log(`  Status: Ready for calibration — run /context-calibrate --floor`);
    }
  }
  console.log();
}

function runCostReport(project?: string, days?: number) {
  const scriptPath = path.join(__dirname, '..', 'cost-report.ts');
  const args = ['npx', 'tsx', scriptPath];
  if (project) args.push('--project', project);
  if (days) args.push('--days', days.toString());

  try {
    execSync(args.join(' '), { stdio: 'inherit', cwd: path.dirname(__dirname) });
  } catch (err) {
    process.exit(1);
  }
}

async function main() {
  const opts = parseArgs();

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  // Detect project if not specified — supports hash, name, or path via registry lookup
  const project = opts.project ? resolveProject(opts.project) : projectHash(process.cwd());

  if (opts.cost) {
    runCostReport(project, opts.days);
    return;
  }

  // Dashboard mode
  const data = await fetchIntrospect(project);
  if (!data) {
    process.exit(1);
  }

  printDashboard(data, project);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
