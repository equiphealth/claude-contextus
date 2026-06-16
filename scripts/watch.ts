#!/usr/bin/env node
/**
 * contextus watch — pretty live follower for daemon activity.
 *
 * Follows ~/.contextus/logs/daemon.log (human-readable stream) with color
 * and optional enrichment from usage.jsonl (scores, dropped patterns).
 *
 * Usage:
 *   contextus watch                    # live tail, all projects
 *   contextus watch --project foo      # filter to one project
 *   contextus watch --verbose          # show floor-dropped chunks
 *   contextus watch --since 1h         # replay last hour then follow
 *   contextus watch --no-follow        # replay only, exit after
 *   contextus watch --json             # tail usage.jsonl raw (for piping)
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import os from 'os';

const LOG_DIR = path.join(os.homedir(), '.contextus', 'logs');
const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');
const USAGE_LOG = path.join(LOG_DIR, 'usage.jsonl');

// --- ANSI colors ---
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

// --- Args ---
interface WatchOpts {
  project?: string;
  verbose: boolean;
  since?: number; // ms ago
  follow: boolean;
  json: boolean;
}

function parseArgs(): WatchOpts {
  const args = process.argv.slice(2);
  const opts: WatchOpts = { verbose: false, follow: true, json: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
      case '-p':
        opts.project = args[++i];
        break;
      case '--verbose':
      case '-v':
        opts.verbose = true;
        break;
      case '--since':
      case '-s':
        opts.since = parseDuration(args[++i]);
        break;
      case '--no-follow':
        opts.follow = false;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }
  return opts;
}

function parseDuration(s: string): number {
  const m = s.match(/^(\d+)(s|m|h|d)$/);
  if (!m) {
    console.error(`Invalid duration: ${s} (use e.g. 30m, 2h, 1d)`);
    process.exit(1);
  }
  const n = parseInt(m[1]);
  const unit = m[2];
  const ms = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * ms;
}

function printHelp(): void {
  console.log(`
${c.bold}contextus watch${c.reset} — live daemon activity stream

${c.dim}Usage:${c.reset}
  contextus watch [options]

${c.dim}Options:${c.reset}
  -p, --project <name>   Filter to a specific project
  -v, --verbose          Show floor-dropped patterns and scores
  -s, --since <dur>      Replay from duration ago (e.g. 30m, 2h, 1d)
      --no-follow        Replay only, don't tail
      --json             Tail usage.jsonl raw (for piping/jq)
  -h, --help             Show this help

${c.dim}Examples:${c.reset}
  contextus watch                    # live stream, all projects
  contextus watch -p automation      # only automation project
  contextus watch --since 1h -v      # last hour, verbose
  contextus watch --json | jq .      # raw JSONL for scripting
`);
}

// --- Formatting ---

function formatDaemonLine(line: string, opts: WatchOpts): string | null {
  // Format: [2026-06-16 13:34:09.258] INFO Retrieved 2 patterns (scores=0.41/0.38, ...)
  const match = line.match(
    /^\[([^\]]+)\]\s+(INFO|WARN|ERROR)\s+(.+?)(?:\s+\((.+)\))?$/
  );
  if (!match) return opts.verbose ? `${c.dim}${line}${c.reset}` : null;

  const [, timestamp, level, message, kvRaw] = match;
  const kv = parseKV(kvRaw ?? '');

  // Project filter
  if (opts.project && kv.project && kv.project !== opts.project) return null;

  // Time (just HH:MM:SS)
  const time = timestamp.split(' ')[1]?.split('.')[0] ?? timestamp;

  // Color by level/event type
  let color = c.dim;
  let icon = ' ';
  if (level === 'ERROR') {
    color = c.red;
    icon = '✗';
  } else if (level === 'WARN') {
    color = c.yellow;
    icon = '⚠';
  } else if (message.startsWith('Retrieved')) {
    color = c.green;
    icon = '✓';
  } else if (message.startsWith('No retrieval')) {
    color = c.dim;
    icon = '○';
  } else if (message.startsWith('Calibration')) {
    color = c.magenta;
    icon = '◆';
  } else if (message.includes('embed') || message.includes('Embed') || message.includes('Reconcile')) {
    color = c.cyan;
    icon = '↻';
  } else {
    color = c.reset;
    icon = '·';
  }

  // Build output
  const projectTag = kv.project ? `${c.dim}[${kv.project}]${c.reset} ` : '';
  let out = `${c.dim}${time}${c.reset} ${color}${icon} ${message}${c.reset} ${projectTag}`;

  // Verbose: show extra kv pairs
  if (opts.verbose && kvRaw) {
    const extras = Object.entries(kv)
      .filter(([k]) => k !== 'project')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (extras) out += `\n       ${c.dim}${extras}${c.reset}`;
  }

  return out;
}

function parseKV(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Match key=value pairs (value may contain / but not ,)
  const pairs = raw.split(/,\s*/);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      result[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  }
  return result;
}

// --- Log following ---

async function replayHistory(file: string, sinceMs: number, opts: WatchOpts): Promise<void> {
  if (!fs.existsSync(file)) return;

  const cutoff = new Date(Date.now() - sinceMs);
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream });

  for await (const line of rl) {
    // Parse timestamp from the line
    const tsMatch = line.match(/^\[([^\]]+)\]/);
    if (tsMatch) {
      const lineDate = new Date(tsMatch[1].replace(' ', 'T') + 'Z');
      if (lineDate < cutoff) continue;
    }

    if (opts.json) {
      process.stdout.write(line + '\n');
    } else {
      const formatted = formatDaemonLine(line, opts);
      if (formatted) process.stdout.write(formatted + '\n');
    }
  }
}

function followFile(file: string, opts: WatchOpts): void {
  if (!fs.existsSync(file)) {
    console.error(`${c.yellow}Waiting for ${file} to appear...${c.reset}`);
  }

  let position = fs.existsSync(file) ? fs.statSync(file).size : 0;
  let buffer = '';

  const poll = (): void => {
    if (!fs.existsSync(file)) return;
    const stat = fs.statSync(file);

    // File was truncated/rotated
    if (stat.size < position) {
      position = 0;
    }

    if (stat.size > position) {
      const fd = fs.openSync(file, 'r');
      const chunk = Buffer.alloc(stat.size - position);
      fs.readSync(fd, chunk, 0, chunk.length, position);
      fs.closeSync(fd);
      position = stat.size;

      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        if (opts.json) {
          process.stdout.write(line + '\n');
        } else {
          const formatted = formatDaemonLine(line, opts);
          if (formatted) process.stdout.write(formatted + '\n');
        }
      }
    }
  };

  // Use fs.watch for efficiency, with polling fallback
  try {
    fs.watch(path.dirname(file), (_, filename) => {
      if (filename === path.basename(file)) poll();
    });
  } catch {
    // Fallback to polling
    setInterval(poll, 500);
  }

  // Initial poll in case file grew between open and watch
  poll();
}

// --- Main ---

async function main(): Promise<void> {
  const opts = parseArgs();
  const logFile = opts.json ? USAGE_LOG : DAEMON_LOG;

  // Header
  if (!opts.json) {
    console.log(
      `${c.bold}contextus watch${c.reset} ${c.dim}— ${opts.project ? `project: ${opts.project}` : 'all projects'}${opts.verbose ? ' (verbose)' : ''}${c.reset}`
    );
    console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
  }

  // Replay history if --since
  if (opts.since) {
    await replayHistory(logFile, opts.since, opts);
    if (!opts.follow) {
      process.exit(0);
    }
    if (!opts.json) {
      console.log(`${c.dim}── live ──${c.reset}`);
    }
  }

  if (opts.follow) {
    followFile(logFile, opts);
  }
}

main().catch((err) => {
  console.error(`${c.red}watch error: ${err.message}${c.reset}`);
  process.exit(1);
});
