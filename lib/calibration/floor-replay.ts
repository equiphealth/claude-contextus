/**
 * Floor-replay engine — the shared heart of cold-start floor calibration.
 *
 * Extracted so BOTH entry points run identical logic (calibration-two-signals):
 *   - `pnpm calibrate-floor` (scripts/calibrate-floor.ts) — the dev/debug CLI.
 *   - `/context-calibrate --floor` (scripts/context-calibrate.ts) — the user front
 *     door that can also --diff/--apply the recommendation.
 *
 * It mines the user's REAL typed prompts from Claude Code transcripts and replays
 * them through the exact query path the daemon uses (embedQuery → search), then
 * hands the per-prompt top-1/top-2 similarities to recommendFloor. Real prompts,
 * not synthetic fragments: floor-calibration-signals showed terse fragments score
 * systematically lower than the sentence-shaped prompts Claude actually receives,
 * which would bias the floor low.
 *
 * The model/embedding/search calls live behind imports; the transcript mining is
 * pure string work. The recommendation is always a STARTING POINT for human
 * eyeball — the apply path is gated in the calling script, never here.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { embedQuery } from '../embedding/embedder.js';
import { search, tableExists } from '../storage/lance-client.js';
import { rerank } from '../retrieval/reranker.js';
import { collapseByFile } from '../retrieval/dedup.js';
import { loadConfig } from '../config.js';
import {
  recommendFloor,
  type ReplayResult,
  type FloorRecommendation
} from './floor-calibration.js';

export interface ReplayOptions {
  /** project whose corpus + transcripts to replay (default: cwd basename) */
  project?: string;
  /** cap the number of prompts replayed (default: all) */
  limit?: number;
}

export interface ReplayOutcome {
  project: string;
  /** prompts actually replayed */
  prompts: number;
  recommendation: FloorRecommendation;
}

/** Reasoned failure so callers can print an actionable message + exit code. */
export class ReplayError extends Error {}

/** Claude Code stores transcripts under ~/.claude/projects/<dir-slug>/*.jsonl. */
export function transcriptDir(project: string): string | null {
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
 * Extract real, human-typed prompts from a project's transcripts. Keeps only
 * `promptSource:"typed"` user lines with string content; drops slash-commands and
 * local-command echoes (not representative of retrieval queries) and dedups
 * identical re-sends.
 */
export function collectPrompts(dir: string, limit: number): string[] {
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
      if (seen.has(t)) continue;
      seen.add(t);
      prompts.push(t);
      if (prompts.length >= limit) return prompts;
    }
  }
  return prompts;
}

/**
 * Run the full replay: mine prompts, embed+search each, recommend a floor.
 * Throws ReplayError (with an actionable message) when there's no corpus, no
 * transcripts, or no usable prompts. `onProgress` is optional CLI feedback.
 */
export async function runFloorReplay(
  opts: ReplayOptions = {},
  onProgress?: (msg: string) => void
): Promise<ReplayOutcome> {
  const project =
    opts.project ??
    crypto.createHash('sha256').update(path.resolve(process.cwd())).digest('hex').slice(0, 12);
  const limit = opts.limit ?? Infinity;
  const cfg = loadConfig();

  if (!(await tableExists(project))) {
    throw new ReplayError(
      `No corpus for project "${project}". Run \`pnpm embed\` first (or pass a different project).`
    );
  }

  const dir = transcriptDir(project);
  if (!dir) {
    throw new ReplayError(
      `No Claude Code transcripts found for "${project}" under ~/.claude/projects/.`
    );
  }

  const prompts = collectPrompts(dir, limit);
  if (prompts.length === 0) {
    throw new ReplayError('No real typed prompts found in transcripts — nothing to replay.');
  }

  onProgress?.(
    `Replaying ${prompts.length} real prompts (project=${project}, provider=${cfg.embedding.provider})…`
  );

  // Mirror the production pipeline so the distribution we calibrate on matches
  // what the daemon actually does: over-fetch chunks → rerank → collapse to one
  // best chunk per FILE → top1/top2 are competing FILES, not sibling chunks of
  // one doc (which would corrupt the #1↔#2 separation signal post-chunking).
  const CHUNK_FANOUT = 4;
  const results: ReplayResult[] = [];
  for (const prompt of prompts) {
    try {
      const vec = await embedQuery(prompt);
      const raw = await search(
        vec,
        Math.max(2, cfg.retrieval.topK) * CHUNK_FANOUT,
        undefined,
        project
      );
      const byFile = collapseByFile(rerank(raw));
      results.push({ top1: byFile[0]?.similarity ?? null, top2: byFile[1]?.similarity ?? null });
    } catch {
      results.push({ top1: null, top2: null });
    }
  }

  return { project, prompts: prompts.length, recommendation: recommendFloor(results) };
}
