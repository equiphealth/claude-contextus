#!/usr/bin/env node
/**
 * Floor-calibration harness (Phase 5 exit criterion).
 *
 * Replays REAL historical prompts — the user's own typed prompts, mined from the
 * Claude Code transcript JSONL files — through the exact query-side retrieval
 * path the daemon uses (embedQuery → search), then reports the similarity
 * distribution and recommends an injection floor.
 *
 * Why real prompts and not synthetic queries: floor-calibration-signals showed
 * terse fragments score systematically LOWER than the sentence-shaped prompts
 * Claude actually receives. Calibrating on fragments biases the floor low. So we
 * pull the genuine article from ~/.claude/projects/<project>/*.jsonl.
 *
 * The recommendation is a STARTING POINT for human eyeball, not an auto-apply —
 * the brief is explicit that the user judges whether the number is sane before
 * adopting it. We print but never write config.
 *
 * Usage:
 *   pnpm calibrate-floor                      # this project's transcripts
 *   pnpm calibrate-floor --project automation # another project's transcripts
 *   pnpm calibrate-floor --limit 100          # cap prompts (default: all)
 *   pnpm calibrate-floor --json               # machine-readable output
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { embedQuery } from '../lib/embedder.js';
import { search, tableExists } from '../lib/lance-client.js';
import { loadConfig } from '../lib/config.js';
import { recommendFloor, type ReplayResult } from '../lib/floor-calibration.js';

interface Args {
  project: string;
  limit: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  let project = path.basename(process.cwd());
  let limit = Infinity;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) project = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[++i]);
    else if (argv[i] === '--json') json = true;
  }
  return { project, limit, json };
}

/** Claude Code stores transcripts under ~/.claude/projects/<dir-slug>/*.jsonl. */
function transcriptDir(project: string): string | null {
  const base = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(base)) return null;
  const slugs = fs.readdirSync(base);
  // The slug is the cwd path with separators → '-'. Match the project name as a
  // trailing segment (…-<project>), falling back to a substring contains.
  const exact = slugs.find((s) => s.endsWith(`-${project}`));
  const loose = slugs.find((s) => s.includes(project));
  const slug = exact ?? loose;
  return slug ? path.join(base, slug) : null;
}

/**
 * Extract real, human-typed prompts from a project's transcripts. We keep only
 * `promptSource:"typed"` user lines with string content, and drop slash-commands
 * and local-command echoes (not representative of retrieval queries).
 */
function collectPrompts(dir: string, limit: number): string[] {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const seen = new Set<string>();
  const prompts: string[] = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf-8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      let o: Record<string, unknown>;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o.type !== 'user' || o.promptSource !== 'typed') continue;
      const msg = o.message as { content?: unknown } | undefined;
      const content = msg?.content;
      if (typeof content !== 'string') continue;
      const t = content.trim();
      if (!t) continue;
      if (t.startsWith('/') || t.startsWith('<command') || t.startsWith('<local-command')) continue;
      if (t.includes('<command-name>')) continue;
      if (seen.has(t)) continue; // dedup identical re-sends
      seen.add(t);
      prompts.push(t);
      if (prompts.length >= limit) return prompts;
    }
  }
  return prompts;
}

function bar(value: number, max: number, width = 24): string {
  const n = max <= 0 ? 0 : Math.round((value / max) * width);
  return '█'.repeat(n) + '·'.repeat(Math.max(0, width - n));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();

  if (!(await tableExists(args.project))) {
    console.error(
      `No corpus for project "${args.project}". Run \`pnpm embed\` first (or pass --project).`
    );
    process.exit(1);
  }

  const dir = transcriptDir(args.project);
  if (!dir) {
    console.error(
      `No Claude Code transcripts found for "${args.project}" under ~/.claude/projects/.`
    );
    process.exit(1);
  }

  const prompts = collectPrompts(dir, args.limit);
  if (prompts.length === 0) {
    console.error('No real typed prompts found in transcripts — nothing to replay.');
    process.exit(1);
  }

  if (!args.json) {
    console.error(
      `Replaying ${prompts.length} real prompts (project=${args.project}, provider=${cfg.embedding.provider})…`
    );
  }

  const results: ReplayResult[] = [];
  for (const prompt of prompts) {
    try {
      const vec = await embedQuery(prompt);
      const hits = await search(vec, Math.max(2, cfg.retrieval.topK), undefined, args.project);
      results.push({
        top1: hits[0]?.similarity ?? null,
        top2: hits[1]?.similarity ?? null,
      });
    } catch {
      results.push({ top1: null, top2: null });
    }
  }

  const rec = recommendFloor(results);

  if (args.json) {
    console.log(
      JSON.stringify({ project: args.project, prompts: prompts.length, ...rec }, null, 2)
    );
    return;
  }

  const p = rec.top1Percentiles;
  const maxP = p.p90;
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  Floor Calibration — top-1 similarity distribution');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  prompts replayed:   ${rec.sampled}  (empty results: ${rec.emptyResults})`);
  console.log(`  top-1 range:        ${rec.top1Min.toFixed(3)} … ${rec.top1Max.toFixed(3)}`);
  console.log('');
  console.log(`  p10  ${p.p10.toFixed(3)}  ${bar(p.p10, maxP)}`);
  console.log(`  p25  ${p.p25.toFixed(3)}  ${bar(p.p25, maxP)}`);
  console.log(`  p50  ${p.p50.toFixed(3)}  ${bar(p.p50, maxP)}  (median)`);
  console.log(`  p75  ${p.p75.toFixed(3)}  ${bar(p.p75, maxP)}`);
  console.log(`  p90  ${p.p90.toFixed(3)}  ${bar(p.p90, maxP)}`);
  console.log('');
  console.log(`  median #1↔#2 separation: ${rec.medianSeparation.toFixed(3)}`);
  console.log('');
  console.log('  floor → injection-rate trade curve:');
  for (const c of rec.coverageCurve) {
    const mark = Math.abs(c.floor - rec.recommendedFloor) < 0.001 ? ' ←recommended' : '';
    console.log(
      `    ${c.floor.toFixed(2)}  ${bar(c.injectionRate, 1, 20)}  ${Math.round(
        c.injectionRate * 100
      )}%${mark}`
    );
  }
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  RECOMMENDED FLOOR:  ${rec.recommendedFloor.toFixed(2)}`);
  console.log(`  coverage at floor:  ${Math.round(rec.coverageAtFloor * 100)}% of prompts inject`);
  console.log(`  current floor:      ${cfg.retrieval.injectionFloor} (plugin.json)`);
  console.log('──────────────────────────────────────────────────────────');
  console.log(`  ${rec.rationale}`);
  console.log('');
  console.log('  This is a recommendation for you to eyeball — NOT auto-applied.');
  console.log('  If sane, set config.retrieval.injectionFloor in plugin.json.');
  console.log('══════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('calibrate-floor failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
