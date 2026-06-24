/**
 * Eval worker core — the testable engine behind daemon/eval-worker.
 *
 * Split from the process wrapper so it can be unit-tested with a MOCKED model
 * caller (Phase-5 brief: "test the parser, mock the model call"). The worker
 * reads jobs from the eval queue, calls the model, parses the reply with the
 * pure logic in eval-calibration, logs a calibration_eval event, and advances
 * the campaign counter.
 *
 * Queue format: one JSON job per line in ~/.contextus/.eval-queue.jsonl. The
 * Stop hook appends; the worker drains. We drain by reading the whole file,
 * processing every line, then truncating — simple and correct for the low
 * volume here (≤1 job per Claude response).
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome, projectHash } from '../config.js';
import {
  buildEvalPrompt,
  parseEvalResponse,
  weightedScore,
  type InjectedPattern
} from './eval-calibration.js';
import { callEvalModel, type EvalCaller, type EvalModelConfig } from './eval-model.js';
import { logCalibrationEval } from '../logger.js';
import { recordSample, readState } from './calibration-state.js';

export const EVAL_QUEUE_PATH = expandHome('~/.contextus/.eval-queue.jsonl');

/** One unit of work: a graded prompt + what was injected for it. */
export interface EvalJob {
  project: string;
  promptHash: string;
  prompt: string;
  thinking: string;
  response: string;
  patterns: InjectedPattern[];
  /** ISO enqueue time — used to estimate eval latency */
  enqueuedAt: string;
}

/** Append a job to the queue (the Stop hook's only write). Best-effort. */
export function enqueueJob(job: EvalJob): void {
  fs.mkdirSync(path.dirname(EVAL_QUEUE_PATH), { recursive: true });
  fs.appendFileSync(EVAL_QUEUE_PATH, JSON.stringify(job) + '\n');
}

/** Read + parse all queued jobs (skipping malformed lines). */
export function readQueue(): EvalJob[] {
  let raw: string;
  try {
    raw = fs.readFileSync(EVAL_QUEUE_PATH, 'utf-8');
  } catch {
    return [];
  }
  const jobs: EvalJob[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      jobs.push(JSON.parse(line) as EvalJob);
    } catch {
      /* skip a torn/partial line */
    }
  }
  return jobs;
}

/**
 * Process one job: call the (injected) model, parse, score, log. Returns the
 * logged result so callers/tests can assert on it. `now` is injectable for
 * deterministic latency in tests.
 */
export async function processJob(
  job: EvalJob,
  model: EvalModelConfig,
  caller: EvalCaller = callEvalModel,
  now: () => number = Date.now
): Promise<{ weightedScore: number; rated: number }> {
  const evalPrompt = buildEvalPrompt(job.prompt, job.thinking, job.response, job.patterns);
  const reply = await caller(evalPrompt, model);
  const ratings = parseEvalResponse(reply, job.patterns);
  const score = weightedScore(ratings, job.patterns.length);

  const enqueued = Date.parse(job.enqueuedAt);
  const latency = Number.isNaN(enqueued) ? 0 : Math.max(0, now() - enqueued);

  logCalibrationEval({
    project: job.project,
    promptHash: job.promptHash,
    retrieved: job.patterns.map((p) => p.id),
    evaluations: ratings.map((r) => ({ pattern: r.pattern, rating: r.rating })),
    weightedScore: score,
    evaluationLatencyMs: latency
  });

  // Also write per-project usage-ratings.jsonl for Phase 2 analytics
  try {
    const projectId = projectHash(job.project);
    const projectUsagePath = path.join(
      expandHome('~/.contextus/data'),
      projectId,
      'usage-ratings.jsonl'
    );
    const projectRating = {
      timestamp: new Date().toISOString(),
      promptHash: job.promptHash,
      evaluations: ratings.map((r) => ({
        pattern: r.pattern,
        rating: r.rating,
        similarity: 0 // TODO: thread retrieval similarity through session-state
      })),
      weightedScore: score,
      evalLatencyMs: latency,
      evalModel: model.model ?? ''
    };
    fs.mkdirSync(path.dirname(projectUsagePath), { recursive: true });
    fs.appendFileSync(projectUsagePath, JSON.stringify(projectRating) + '\n');
  } catch {
    // Best-effort — never break eval on logging failure
  }

  return { weightedScore: score, rated: ratings.length };
}

/**
 * Drain the queue once: process every job, then truncate the file. Honors the
 * campaign budget — stops calling the model once the target is hit (the surplus
 * is dropped, which is fine: calibration is a bounded sample, not a backlog to
 * exhaust). `caller` is injected so tests never hit the network.
 */
export async function drainQueue(caller: EvalCaller = callEvalModel): Promise<number> {
  const jobs = readQueue();
  if (jobs.length === 0) return 0;

  let processed = 0;
  for (const job of jobs) {
    const state = readState();
    if (!state.evaluateUsage) break; // campaign finished mid-drain
    try {
      await processJob(job, state.model, caller);
      recordSample();
      processed++;
    } catch {
      /* a failed eval shouldn't wedge the queue; drop it and continue */
    }
  }
  // Clear processed jobs (truncate). Anything that arrived during the drain is
  // rare at this volume; the next tick picks it up after a fresh read.
  try {
    fs.writeFileSync(EVAL_QUEUE_PATH, '');
  } catch {
    /* best-effort */
  }
  return processed;
}
