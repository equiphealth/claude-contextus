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

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const LOG_DIR = path.join(os.homedir(), '.contextus', 'logs');
const DAEMON_LOG = path.join(LOG_DIR, 'daemon.log');
const USAGE_LOG = path.join(LOG_DIR, 'usage.jsonl');
const PARANOID_LOG = path.join(LOG_DIR, 'paranoid.jsonl');

// --- ANSI colors ---
const c = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

// --- Args ---
interface WatchOpts {
  project?: string;
  verbose: boolean;
  since?: number; // ms ago
  follow: boolean;
  json: boolean;
  paranoid: boolean;
  group: boolean;
  showSynthetic: boolean;
}

/** Unit-test and other synthetic project labels that pollute real logs.
 *  Filtered by default (use --show-synthetic to include). */
export const SYNTHETIC_PROJECTS = new Set(['demo', 'test-project']);

export function shouldSkip(project: string | undefined, opts: WatchOpts): boolean {
  // Explicit -p always wins (even for synthetic projects the user asked for).
  if (opts.project && project) return project !== opts.project;
  if (!opts.showSynthetic && project && SYNTHETIC_PROJECTS.has(project)) return true;
  return false;
}

function parseArgs(): WatchOpts {
  const args = process.argv.slice(2);
  const opts: WatchOpts = {
    verbose: false,
    follow: true,
    json: false,
    paranoid: false,
    // Stream lines immediately. --group holds each prompt's lines until its
    // verdict arrives (narrative blocks, but delayed — verdicts can lag).
    group: false,
    showSynthetic: false
  };

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
      case '--paranoid':
        opts.paranoid = true;
        break;
      case '--group':
      case '-g':
        opts.group = true;
        break;
      case '--show-synthetic':
        opts.showSynthetic = true;
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
  -g, --group            Group events into per-prompt blocks (waits for verdicts — delayed)
      --show-synthetic   Include unit-test projects (demo, test-project)
      --no-follow        Replay only, don't tail
      --json             Tail usage.jsonl raw (for piping/jq)
      --paranoid         Tail paranoid.jsonl (full prompt + injection text)
  -h, --help             Show this help

${c.dim}Examples:${c.reset}
  contextus watch                    # live stream, all projects
  contextus watch -p automation      # only automation project
  contextus watch --since 1h -v      # last hour, verbose
  contextus watch --json | jq .      # raw JSONL for scripting
  contextus watch --paranoid         # full round-trip (requires logging.paranoid=true)
`);
}

// --- Formatting ---

export function formatDaemonLine(
  line: string,
  opts: WatchOpts,
  usage?: Map<string, PromptFacts>
): string | null {
  // Format: [2026-06-16 13:34:09.258] INFO Retrieved 2 patterns (scores=0.41/0.38, ...)
  const match = line.match(/^\[([^\]]+)\]\s+(INFO|WARN|ERROR)\s+(.+?)(?:\s+\((.+)\))?$/);
  if (!match) return opts.verbose ? `${c.dim}${line}${c.reset}` : null;

  const [, timestamp, level, message, kvRaw] = match;
  const kv = parseKV(kvRaw ?? '');

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
  } else if (message.startsWith('Expansion fired')) {
    color = c.cyan;
    icon = '⚡';
  } else if (message.startsWith('Expansion skipped')) {
    color = c.dim;
    icon = '⊘';
  } else if (message.startsWith('Calibration')) {
    color = c.magenta;
    icon = '◆';
  } else if (
    message.includes('embed') ||
    message.includes('Embed') ||
    message.includes('Reconcile')
  ) {
    color = c.cyan;
    icon = '↻';
  } else {
    color = c.reset;
    icon = '·';
  }

  // Project filter (+ synthetic-test filter)
  if (shouldSkip(kv.project, opts)) return null;

  const facts = kv.phash && usage ? usage.get(kv.phash) : undefined;

  // Build output
  const projectTag = kv.project ? `${c.dim}[${kv.project}]${c.reset} ` : '';
  let out = `${c.dim}${time}${c.reset} ${color}${icon} ${message}${c.reset} ${projectTag}`;

  // Prompt preview (daemon logs it quoted; parseKV strips the quotes)
  if (kv.prompt) {
    out += `\n       ${c.dim}"${kv.prompt}"${c.reset}`;
  }

  // Retrieval: pattern names + scores, joined from usage.jsonl by prompt hash
  if (message.startsWith('Retrieved') && facts && facts.retrieved.length > 0) {
    const names = facts.retrieved
      .map((f, i) => {
        const s = facts.scores[i];
        return `[${i + 1}] ${f}${s !== undefined ? ` (${s.toFixed(2)})` : ''}`;
      })
      .join('  ');
    out += `\n       ${c.green}${names}${c.reset}`;
    if (kv.rescued === 'true') {
      const best = facts.scores[0];
      const pre =
        kv.initialBest ?? (facts.initialBest !== undefined ? String(facts.initialBest) : '?');
      const post = best !== undefined ? best.toFixed(2) : '?';
      out += `\n       ${c.cyan}↳ ⚡ expansion rescued it (${pre} → ${post})${renderVariantLine(facts)}${c.reset}`;
    }
  } else if (message.startsWith('No retrieval') && kv.rescued === 'false') {
    out += `\n       ${c.yellow}↳ ⚡ expansion fired but still below floor${c.reset}`;
  }

  // Eval verdicts: link back to the patterns they judged
  if (message.startsWith('Usage signal') && facts && facts.injected) {
    const used = facts.used ?? [];
    const names = facts.injected.length > 0 ? facts.injected.join(', ') : '—';
    out += `\n       ${c.dim}↳ on: ${names} — used ${used.length}/${facts.injected.length}${c.reset}`;
  } else if (message.startsWith('Calibration eval') && facts && facts.evalScore !== undefined) {
    const names = facts.retrieved.length > 0 ? facts.retrieved.join(', ') : '—';
    out += `\n       ${c.dim}↳ judged ${facts.evalScore.toFixed(2)} on: ${names} (rated ${facts.evalRated ?? '?'}/${facts.evalOf ?? '?'})${c.reset}`;
  }

  // Verbose: show extra kv pairs
  if (opts.verbose && kvRaw) {
    const extras = Object.entries(kv)
      .filter(([k]) => k !== 'project' && k !== 'prompt')
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    if (extras) out += `\n       ${c.dim}${extras}${c.reset}`;
  }

  return out;
}

/** `variant [N] → M patterns` (N=-1 renders as the original query). */
function renderVariantLine(facts: PromptFacts): string {
  const attr = facts.variantAttribution;
  if (!attr || facts.retrieved.length === 0) return '';
  const counts = new Map<number, number>();
  for (const f of facts.retrieved) {
    const v = attr[f];
    if (v === undefined) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let top: number | null = null;
  let topCount = 0;
  for (const [v, n] of counts) {
    if (n > topCount) {
      top = v;
      topCount = n;
    }
  }
  if (top === null) return '';
  const who = top === -1 ? 'original query' : `variant [${top}]`;
  return ` · ${who} → ${topCount}/${facts.retrieved.length} patterns`;
}

export function parseKV(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  // Split on commas NOT inside double quotes (prompt="..." values contain commas).
  const pairs: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === ',' && !inQuotes) {
      pairs.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) pairs.push(cur);
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq > 0) {
      const value = pair.slice(eq + 1).trim();
      result[pair.slice(0, eq).trim()] = value.replace(/^"(.*)"$/, '$1');
    }
  }
  return result;
}

// --- Usage index (joined from usage.jsonl by prompt_hash) ---

/** Accumulated facts about one prompt, from all usage.jsonl event types. */
export interface PromptFacts {
  project?: string;
  promptPreview?: string;
  retrieved: string[];
  scores: number[];
  best?: number;
  reason?: string;
  used?: string[];
  injected?: string[];
  usageRate?: number;
  evalScore?: number;
  evalRated?: number;
  evalOf?: number;
  initialBest?: number;
  rescued?: boolean;
  variantAttribution?: Record<string, number>;
}

function emptyFacts(): PromptFacts {
  return { retrieved: [], scores: [] };
}

/** Ingest one parsed usage.jsonl record into the index (mutates, returns the entry). */
export function indexUsageRecord(index: Map<string, PromptFacts>, e: any): PromptFacts | null {
  if (!e || typeof e !== 'object') return null;
  const h = typeof e.prompt_hash === 'string' ? e.prompt_hash : null;
  if (!h) return null;
  let r = index.get(h);
  if (!r) {
    r = emptyFacts();
    index.set(h, r);
  }
  if (e.project && !r.project) r.project = e.project;
  if (typeof e.prompt_preview === 'string' && !r.promptPreview) {
    r.promptPreview = e.prompt_preview;
  }
  if (e.type === 'retrieval') {
    if (Array.isArray(e.retrieved) && e.retrieved.length > 0) {
      r.retrieved = e.retrieved.filter((x: unknown) => typeof x === 'string');
      r.scores = Array.isArray(e.similarity_scores)
        ? e.similarity_scores.filter((x: unknown) => typeof x === 'number')
        : [];
    } else {
      if (typeof e.best_match_score === 'number') r.best = e.best_match_score;
      if (typeof e.reason === 'string') r.reason = e.reason;
    }
    if (typeof e.initial_best === 'number') r.initialBest = e.initial_best;
    if (typeof e.rescued === 'boolean') r.rescued = e.rescued;
    if (e.variant_attribution && typeof e.variant_attribution === 'object') {
      r.variantAttribution = e.variant_attribution;
    }
  } else if (e.type === 'usage_signal') {
    if (Array.isArray(e.used)) r.used = e.used.filter((x: unknown) => typeof x === 'string');
    if (Array.isArray(e.injected)) {
      r.injected = e.injected.filter((x: unknown) => typeof x === 'string');
    }
    if (typeof e.usage_rate === 'number') r.usageRate = e.usage_rate;
  } else if (e.type === 'calibration_eval') {
    if (typeof e.weighted_score === 'number') r.evalScore = e.weighted_score;
    if (Array.isArray(e.evaluations)) r.evalRated = e.evaluations.length;
    if (Array.isArray(e.retrieved)) {
      r.evalOf = e.retrieved.length;
      if (r.retrieved.length === 0) {
        r.retrieved = e.retrieved.filter((x: unknown) => typeof x === 'string');
      }
    }
  }
  return r;
}

/** Parse + ingest one raw usage.jsonl line; no-ops on garbage. */
export function indexUsageLine(index: Map<string, PromptFacts>, line: string): void {
  try {
    indexUsageRecord(index, JSON.parse(line));
  } catch {
    /* skip malformed lines */
  }
}

/** Cap index growth in long follow sessions (Map preserves insertion order). */
export function pruneIndex(index: Map<string, PromptFacts>, max = 2000): void {
  while (index.size > max) {
    const oldest = index.keys().next();
    if (oldest.done) break;
    index.delete(oldest.value);
  }
}

// --- Grouped view (per-prompt narrative blocks) ---

export interface GroupBlock {
  hash: string;
  project?: string;
  prompt?: string;
  lines: string[];
}

/**
 * Buffers formatted daemon lines by prompt hash so a prompt reads top to
 * bottom: prompt → expansion → retrieval → verdicts. Lines without a hash
 * bypass grouping. Flush a group when a verdict (signal/eval) lands, when
 * the group goes quiet, or at end of replay.
 */
export class GroupBuffer {
  private blocks = new Map<
    string,
    { project?: string; prompt?: string; lines: string[]; lastUpdate: number }
  >();
  private order: string[] = [];

  push(
    hash: string | undefined,
    project: string | undefined,
    prompt: string | undefined,
    line: string
  ): GroupBlock[] {
    if (!hash) return [{ hash: '', project, prompt, lines: [line] }];
    let b = this.blocks.get(hash);
    if (!b) {
      b = { project, prompt, lines: [], lastUpdate: Date.now() };
      this.blocks.set(hash, b);
      this.order.push(hash);
    }
    b.lastUpdate = Date.now();
    if (project && !b.project) b.project = project;
    if (prompt && !b.prompt) b.prompt = prompt;
    b.lines.push(line);
    return [];
  }

  /** Groups whose last update is older than maxAgeMs. Oldest first. */
  flushStale(maxAgeMs: number): GroupBlock[] {
    const now = Date.now();
    const out: GroupBlock[] = [];
    for (const h of [...this.order]) {
      const b = this.blocks.get(h);
      if (b && now - b.lastUpdate > maxAgeMs) {
        out.push({ hash: h, project: b.project, prompt: b.prompt, lines: b.lines });
        this.blocks.delete(h);
        this.order = this.order.filter((x) => x !== h);
      }
    }
    return out;
  }

  /** Flush one group by hash (e.g. when its verdict arrives). */
  flushOne(hash: string): GroupBlock[] {
    const b = this.blocks.get(hash);
    if (!b) return [];
    this.blocks.delete(hash);
    this.order = this.order.filter((x) => x !== hash);
    return [{ hash, project: b.project, prompt: b.prompt, lines: b.lines }];
  }

  flushAll(): GroupBlock[] {
    const out: GroupBlock[] = [];
    for (const h of this.order) {
      const b = this.blocks.get(h);
      if (b) out.push({ hash: h, project: b.project, prompt: b.prompt, lines: b.lines });
    }
    this.blocks.clear();
    this.order = [];
    return out;
  }

  get pending(): number {
    return this.blocks.size;
  }
}

export function renderGroup(block: GroupBlock): string {
  const header = block.prompt
    ? `── "${block.prompt.slice(0, 120)}"`
    : `── ${block.hash || 'ungrouped'}`;
  const proj = block.project ? ` [${block.project}]` : '';
  const body = block.lines.map((l) => `  ${l}`).join('\n');
  return `${c.dim}${header}${proj}${c.reset}\n${body}`;
}

// --- Daemon line metadata (for grouping) ---

/** Extract group key fields from a raw daemon.log line without formatting it. */
export function parseDaemonMeta(line: string): {
  phash?: string;
  project?: string;
  prompt?: string;
  isVerdict: boolean;
} {
  const match = line.match(/^\[[^\]]+\]\s+(INFO|WARN|ERROR)\s+(.+?)(?:\s+\((.+)\))?$/);
  if (!match) return { isVerdict: false };
  const [, , message, kvRaw] = match;
  const kv = parseKV(kvRaw ?? '');
  return {
    phash: kv.phash || undefined,
    project: kv.project || undefined,
    prompt: kv.prompt || undefined,
    isVerdict: message.startsWith('Usage signal') || message.startsWith('Calibration eval')
  };
}

// --- Paranoid formatting ---

interface ParanoidEntry {
  timestamp: string;
  project: string;
  prompt_hash: string;
  prompt: string;
  injection: string;
  retrieved: string[];
  similarity_scores: number[];
  latency_ms: number;
}

function formatParanoidLine(line: string, opts: WatchOpts): string | null {
  let entry: ParanoidEntry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }

  if (opts.project && entry.project !== opts.project) return null;

  const time = entry.timestamp.split('T')[1]?.split('.')[0] ?? entry.timestamp;
  const scores = entry.similarity_scores.map((s: number) => s.toFixed(2)).join('/');
  const noInject = entry.retrieved.length === 0;
  const icon = noInject ? '○' : '✓';
  const iconColor = noInject ? c.dim : c.green;

  let out = `\n${c.dim}${'═'.repeat(70)}${c.reset}\n`;
  out += `${c.dim}${time}${c.reset} ${iconColor}${icon}${c.reset} ${c.dim}[${entry.project}]${c.reset} ${c.dim}${entry.latency_ms}ms${c.reset}`;
  if (scores) out += ` ${c.dim}scores=${scores}${c.reset}`;
  out += '\n';

  // Prompt
  out += `\n${c.bold}${c.cyan}PROMPT:${c.reset}\n`;
  const promptPreview =
    entry.prompt.length > 500
      ? entry.prompt.slice(0, 500) + `${c.dim}… (${entry.prompt.length} chars)${c.reset}`
      : entry.prompt;
  out += `${promptPreview}\n`;

  // Injection
  if (entry.injection) {
    out += `\n${c.bold}${c.green}INJECTED (${entry.retrieved.length} patterns):${c.reset}\n`;
    out += `${c.dim}${entry.retrieved.join(', ')}${c.reset}\n`;
    if (opts.verbose) {
      out += `\n${entry.injection}\n`;
    } else {
      const preview =
        entry.injection.length > 300
          ? entry.injection.slice(0, 300) +
            `\n${c.dim}… (${entry.injection.length} chars, use -v for full)${c.reset}`
          : entry.injection;
      out += `\n${preview}\n`;
    }
  } else {
    out += `\n${c.yellow}NO INJECTION${c.reset} ${c.dim}(best score: ${scores})${c.reset}\n`;
  }

  return out;
}

// --- Log following ---

/**
 * Load usage.jsonl facts into the join index. Bounded by cutoff when given
 * (replay windows); callers without a window get the whole file (one-time
 * cost at startup, ~tens of MB at most).
 */
export interface UsageIndexLoad {
  index: Map<string, PromptFacts>;
  /** non-blank lines scanned (before cutoff filtering) */
  lines: number;
  /** wall-clock load time, for startup-latency diagnosis */
  ms: number;
}

export async function loadUsageIndex(cutoff: Date | null): Promise<UsageIndexLoad> {
  const index = new Map<string, PromptFacts>();
  const started = Date.now();
  let lines = 0;
  if (!fs.existsSync(USAGE_LOG)) return { index, lines, ms: 0 };
  const stream = fs.createReadStream(USAGE_LOG, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream });
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines++;
    // Parse once: cutoff check and ingest share the object (this file is
    // tens of MB; a second parse per line doubles startup cost).
    let e: unknown;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (cutoff) {
      const ts = (e as { timestamp?: unknown }).timestamp;
      if (typeof ts === 'string' && new Date(ts) < cutoff) continue;
    }
    indexUsageRecord(index, e);
  }
  pruneIndex(index);
  return { index, lines, ms: Date.now() - started };
}

async function replayHistory(
  file: string,
  sinceMs: number,
  opts: WatchOpts,
  usage: Map<string, PromptFacts>,
  emit: (formatted: string | null, meta: ReturnType<typeof parseDaemonMeta>) => void
): Promise<void> {
  if (!fs.existsSync(file)) return;

  const cutoff = new Date(Date.now() - sinceMs);
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream });

  for await (const line of rl) {
    // Parse timestamp from the line
    if (opts.paranoid) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.timestamp) < cutoff) continue;
      } catch {
        continue;
      }
    } else {
      const tsMatch = line.match(/^\[([^\]]+)\]/);
      if (tsMatch) {
        const lineDate = new Date(tsMatch[1].replace(' ', 'T') + 'Z');
        if (lineDate < cutoff) continue;
      }
    }

    if (opts.json) {
      process.stdout.write(line + '\n');
    } else if (opts.paranoid) {
      const formatted = formatParanoidLine(line, opts);
      if (formatted) process.stdout.write(formatted + '\n');
    } else {
      emit(formatDaemonLine(line, opts, usage), parseDaemonMeta(line));
    }
  }
}

/** Raw single-file tail (used for --json and --paranoid modes). */
function followRawFile(file: string, opts: WatchOpts): void {
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
          const formatted = formatParanoidLine(line, opts);
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

interface FileCursor {
  path: string;
  position: number;
  buffer: string;
}

/** Read newly appended complete lines from a tailed file. */
function readNewLines(cursor: FileCursor): string[] {
  if (!fs.existsSync(cursor.path)) return [];
  const stat = fs.statSync(cursor.path);
  if (stat.size < cursor.position) {
    cursor.position = 0; // truncated/rotated
    cursor.buffer = '';
  }
  if (stat.size <= cursor.position) return [];
  const fd = fs.openSync(cursor.path, 'r');
  const chunk = Buffer.alloc(stat.size - cursor.position);
  fs.readSync(fd, chunk, 0, chunk.length, cursor.position);
  fs.closeSync(fd);
  cursor.position = stat.size;
  cursor.buffer += chunk.toString('utf8');
  const lines = cursor.buffer.split('\n');
  cursor.buffer = lines.pop() ?? '';
  return lines.filter((l) => l.trim().length > 0);
}

/** Live tail: daemon.log renders through the join index, usage.jsonl feeds it. */
function followLive(
  opts: WatchOpts,
  usage: Map<string, PromptFacts>,
  emit: (formatted: string | null, meta: ReturnType<typeof parseDaemonMeta>) => void
): void {
  const daemon: FileCursor = {
    path: DAEMON_LOG,
    position: fs.existsSync(DAEMON_LOG) ? fs.statSync(DAEMON_LOG).size : 0,
    buffer: ''
  };
  const usageLog: FileCursor = {
    path: USAGE_LOG,
    position: fs.existsSync(USAGE_LOG) ? fs.statSync(USAGE_LOG).size : 0,
    buffer: ''
  };

  const poll = (): void => {
    for (const line of readNewLines(usageLog)) {
      indexUsageLine(usage, line);
    }
    pruneIndex(usage);
    for (const line of readNewLines(daemon)) {
      emit(formatDaemonLine(line, opts, usage), parseDaemonMeta(line));
    }
  };

  // fs.watch for immediacy, plus a backup poll so a missed/coalesced backend
  // event never stalls the stream (FSEvents on macOS can lag under load).
  // The interval stays ref'd: if fs.watch throws, the poll alone must still
  // keep the process alive — otherwise watch prints "── live ──" and exits.
  setInterval(poll, 2000);
  try {
    fs.watch(LOG_DIR, (_, filename) => {
      if (filename === path.basename(DAEMON_LOG) || filename === path.basename(USAGE_LOG)) {
        poll();
      }
    });
  } catch {
    // fs.watch unavailable — the backup poll above carries the stream.
  }

  poll();
}

// --- Main ---

async function main(): Promise<void> {
  const opts = parseArgs();

  // Raw modes keep the legacy single-file behavior.
  if (opts.json || opts.paranoid) {
    const logFile = opts.paranoid ? PARANOID_LOG : USAGE_LOG;
    if (!opts.json) {
      console.log(
        `${c.bold}contextus watch${c.reset} ${c.dim}— ${opts.project ? `project: ${opts.project}` : 'all projects'} (PARANOID)${c.reset}`
      );
      console.log(`${c.red}⚠ Paranoid mode: logging full prompts + injections${c.reset}`);
      console.log(`${c.dim}  Requires logging.paranoid=true in config${c.reset}`);
      console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);
    }
    if (opts.since) {
      await replayHistory(logFile, opts.since, opts, new Map(), () => {});
    }
    if (opts.follow) {
      followRawFile(logFile, opts);
    }
    return;
  }

  // Header
  const modeBits = [
    opts.verbose ? 'verbose' : '',
    opts.group ? 'grouped' : '',
    !opts.showSynthetic ? 'hiding synthetic projects' : ''
  ]
    .filter(Boolean)
    .join(', ');
  console.log(
    `${c.bold}contextus watch${c.reset} ${c.dim}— ${opts.project ? `project: ${opts.project}` : 'all projects'}${modeBits ? ` (${modeBits})` : ''}${c.reset}`
  );
  console.log(`${c.dim}${'─'.repeat(60)}${c.reset}`);

  // Join index: usage.jsonl facts keyed by prompt hash, so retrieval lines
  // can show pattern names and verdicts can link back to what they judged.
  const loaded = await loadUsageIndex(opts.since ? new Date(Date.now() - opts.since) : null);
  const usage = loaded.index;
  if (opts.verbose) {
    console.log(
      `${c.dim}index: ${usage.size} prompts from ${loaded.lines} usage lines in ${loaded.ms}ms (${opts.group ? 'grouped' : 'streaming'})${c.reset}`
    );
  }

  const group = opts.group ? new GroupBuffer() : null;
  const flushTimer = opts.group
    ? setInterval(() => {
        for (const b of group!.flushStale(30_000)) console.log(renderGroup(b));
      }, 5_000)
    : null;
  if (flushTimer) flushTimer.unref();

  const emit = (formatted: string | null, meta: ReturnType<typeof parseDaemonMeta>): void => {
    if (formatted === null) return;
    if (group && meta.phash) {
      group.push(meta.phash, meta.project, meta.prompt, formatted);
      if (meta.isVerdict) {
        for (const b of group.flushOne(meta.phash)) console.log(renderGroup(b));
      }
    } else {
      console.log(formatted);
    }
  };

  // Replay history if --since
  if (opts.since) {
    await replayHistory(DAEMON_LOG, opts.since, opts, usage, emit);
    if (!opts.follow) {
      if (group) for (const b of group.flushAll()) console.log(renderGroup(b));
      if (flushTimer) clearInterval(flushTimer);
      return;
    }
    console.log(`${c.dim}── live ──${c.reset}`);
  }

  if (opts.follow) {
    if (group) {
      process.on('SIGINT', () => {
        for (const b of group.flushAll()) console.log(renderGroup(b));
        process.exit(0);
      });
    }
    followLive(opts, usage, emit);
  } else if (group) {
    for (const b of group.flushAll()) console.log(renderGroup(b));
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`${c.red}watch error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
