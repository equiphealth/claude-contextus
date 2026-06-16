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
import fs from 'fs';
import path from 'path';
import { expandHome } from '../config.js';
import { buildEvalPrompt, parseEvalResponse, weightedScore, } from './eval-calibration.js';
import { callEvalModel } from './eval-model.js';
import { logCalibrationEval } from '../logger.js';
import { recordSample, readState } from './calibration-state.js';
export const EVAL_QUEUE_PATH = expandHome('~/.contextus/.eval-queue.jsonl');
/** Append a job to the queue (the Stop hook's only write). Best-effort. */
export function enqueueJob(job) {
    fs.mkdirSync(path.dirname(EVAL_QUEUE_PATH), { recursive: true });
    fs.appendFileSync(EVAL_QUEUE_PATH, JSON.stringify(job) + '\n');
}
/** Read + parse all queued jobs (skipping malformed lines). */
export function readQueue() {
    let raw;
    try {
        raw = fs.readFileSync(EVAL_QUEUE_PATH, 'utf-8');
    }
    catch {
        return [];
    }
    const jobs = [];
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        try {
            jobs.push(JSON.parse(line));
        }
        catch {
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
export async function processJob(job, model, caller = callEvalModel, now = Date.now) {
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
        evaluationLatencyMs: latency,
    });
    return { weightedScore: score, rated: ratings.length };
}
/**
 * Drain the queue once: process every job, then truncate the file. Honors the
 * campaign budget — stops calling the model once the target is hit (the surplus
 * is dropped, which is fine: calibration is a bounded sample, not a backlog to
 * exhaust). `caller` is injected so tests never hit the network.
 */
export async function drainQueue(caller = callEvalModel) {
    const jobs = readQueue();
    if (jobs.length === 0)
        return 0;
    let processed = 0;
    for (const job of jobs) {
        const state = readState();
        if (!state.evaluateUsage)
            break; // campaign finished mid-drain
        try {
            await processJob(job, state.model, caller);
            recordSample();
            processed++;
        }
        catch {
            /* a failed eval shouldn't wedge the queue; drop it and continue */
        }
    }
    // Clear processed jobs (truncate). Anything that arrived during the drain is
    // rare at this volume; the next tick picks it up after a fresh read.
    try {
        fs.writeFileSync(EVAL_QUEUE_PATH, '');
    }
    catch {
        /* best-effort */
    }
    return processed;
}
//# sourceMappingURL=eval-worker-core.js.map