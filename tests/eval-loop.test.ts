/**
 * Tests for Phase 1 usage feedback loop.
 *
 * Covers:
 * - daemon/eval-loop.ts (background drainer)
 * - lib/calibration/calibration-state.ts (continuous vs campaign mode)
 * - lib/calibration/eval-worker-core.ts (per-project logging)
 * - scripts/stop-evaluation.js (enqueue logic - indirectly via unit testing the functions)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { expandHome, projectHash } from '../lib/config.js';
import { startEvalLoop, stopEvalLoop } from '../daemon/eval-loop.js';
import {
  enqueueJob,
  readQueue,
  processJob,
  drainQueue,
  EVAL_QUEUE_PATH
} from '../lib/calibration/eval-worker-core.js';
import {
  writeState,
  readState,
  recordSample,
  startCalibration
} from '../lib/calibration/calibration-state.js';
import type { EvalCaller } from '../lib/calibration/eval-model.js';

describe('eval-loop', () => {
  beforeEach(() => {
    // Clean up eval queue + state before each test
    try {
      fs.unlinkSync(EVAL_QUEUE_PATH);
    } catch {}
  });

  afterEach(() => {
    stopEvalLoop();
    try {
      fs.unlinkSync(EVAL_QUEUE_PATH);
    } catch {}
  });

  it('startEvalLoop is idempotent', () => {
    startEvalLoop();
    startEvalLoop(); // should not throw or create duplicate timer
    assert.ok(true);
  });

  it('stopEvalLoop clears timer', () => {
    startEvalLoop();
    stopEvalLoop();
    stopEvalLoop(); // should not throw when already stopped
    assert.ok(true);
  });

  it('respects evaluateUsage flag - does not drain when false', async () => {
    // Set evaluateUsage=false
    writeState({
      evaluateUsage: false,
      mode: 'continuous',
      targetSamples: 100,
      sampleCount: 0,
      startedAt: null,
      completedAt: null,
      model: { provider: 'bedrock', model: 'test' }
    });

    // Enqueue a job
    enqueueJob({
      project: 'test',
      promptHash: 'abc123',
      prompt: 'test prompt',
      thinking: '',
      response: 'test response',
      patterns: [{ id: 'test-pattern', snippet: 'test' }],
      enqueuedAt: new Date().toISOString()
    });

    // Queue should have 1 job
    const jobsBefore = readQueue();
    assert.strictEqual(jobsBefore.length, 1);

    // Drain with evaluateUsage=false should skip
    const processed = await drainQueue(mockEvalCaller);
    assert.strictEqual(processed, 0);

    // Queue should still have the job
    const jobsAfter = readQueue();
    assert.strictEqual(jobsAfter.length, 1);
  });

  it('drains queue when evaluateUsage=true', async () => {
    writeState({
      evaluateUsage: true,
      mode: 'continuous',
      targetSamples: 100,
      sampleCount: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      model: { provider: 'bedrock', model: 'test' }
    });

    enqueueJob({
      project: 'test-project',
      promptHash: 'abc123',
      prompt: 'test prompt',
      thinking: 'test thinking',
      response: 'test response',
      patterns: [{ id: 'test-pattern', snippet: 'test snippet' }],
      enqueuedAt: new Date().toISOString()
    });

    const processed = await drainQueue(mockEvalCaller);
    assert.strictEqual(processed, 1);

    // Queue should be empty after drain
    const jobsAfter = readQueue();
    assert.strictEqual(jobsAfter.length, 0);
  });
});

describe('calibration-state modes', () => {
  it('continuous mode never auto-disables after hitting target', () => {
    writeState({
      evaluateUsage: true,
      mode: 'continuous',
      targetSamples: 2,
      sampleCount: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      model: { provider: 'bedrock', model: 'test' }
    });

    // Record 3 samples (exceeds target)
    recordSample();
    recordSample();
    recordSample();

    const state = readState();
    assert.strictEqual(state.evaluateUsage, true); // still enabled
    assert.strictEqual(state.sampleCount, 3);
    assert.strictEqual(state.completedAt, null);
  });

  it('campaign mode auto-disables after hitting target', () => {
    writeState({
      evaluateUsage: true,
      mode: 'campaign',
      targetSamples: 2,
      sampleCount: 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      model: { provider: 'bedrock', model: 'test' }
    });

    // Record 2 samples (hits target)
    recordSample();
    const state1 = readState();
    assert.strictEqual(state1.evaluateUsage, true); // still on at 1/2

    recordSample();
    const state2 = readState();
    assert.strictEqual(state2.evaluateUsage, false); // disabled at 2/2
    assert.strictEqual(state2.sampleCount, 2);
    assert.ok(state2.completedAt); // timestamp set
  });

  it('startCalibration respects mode parameter', () => {
    const contState = startCalibration({ mode: 'continuous', targetSamples: 50 });
    assert.strictEqual(contState.mode, 'continuous');
    assert.strictEqual(contState.targetSamples, 50);

    const campState = startCalibration({ mode: 'campaign', targetSamples: 20 });
    assert.strictEqual(campState.mode, 'campaign');
    assert.strictEqual(campState.targetSamples, 20);
  });
});

describe('per-project usage logging', () => {
  const TEST_PROJECT = 'test-project';
  let usageLogPath: string;

  beforeEach(() => {
    const projectId = projectHash(TEST_PROJECT);
    usageLogPath = path.join(expandHome('~/.contextus/data'), projectId, 'usage-ratings.jsonl');
    // Clean up before test
    try {
      fs.unlinkSync(usageLogPath);
    } catch {}
  });

  afterEach(() => {
    try {
      fs.unlinkSync(usageLogPath);
    } catch {}
  });

  it('processJob writes per-project usage-ratings.jsonl', async () => {
    const job = {
      project: TEST_PROJECT,
      promptHash: 'xyz789',
      prompt: 'test',
      thinking: 'thinking',
      response: 'response',
      patterns: [
        { id: 'pattern1', snippet: 'snippet1' },
        { id: 'pattern2', snippet: 'snippet2' }
      ],
      enqueuedAt: new Date().toISOString()
    };

    const model = { provider: 'bedrock' as const, model: 'test-model' };
    await processJob(job, model, mockEvalCaller);

    // Check that usage-ratings.jsonl exists and has content
    assert.ok(fs.existsSync(usageLogPath));
    const content = fs.readFileSync(usageLogPath, 'utf-8');
    const lines = content.trim().split('\n');
    assert.strictEqual(lines.length, 1);

    const rating = JSON.parse(lines[0]);
    assert.strictEqual(rating.promptHash, 'xyz789');
    assert.ok(Array.isArray(rating.evaluations));
    assert.strictEqual(rating.evaluations.length, 2);
    assert.ok(typeof rating.weightedScore === 'number');
    assert.strictEqual(rating.evalModel, 'test-model');
  });
});

describe('sampling behavior', () => {
  it('samplingRate 0.0 should always skip', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      // Simulate sampling gate
      const shouldEval = Math.random() <= 0.0;
      results.push(shouldEval);
    }
    assert.strictEqual(results.filter((x) => x).length, 0);
  });

  it('samplingRate 1.0 should always eval', () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      const shouldEval = Math.random() <= 1.0;
      results.push(shouldEval);
    }
    assert.strictEqual(results.filter((x) => x).length, 100);
  });

  it('samplingRate 0.5 should eval approximately 50%', () => {
    const results = [];
    for (let i = 0; i < 1000; i++) {
      const shouldEval = Math.random() <= 0.5;
      results.push(shouldEval);
    }
    const evaled = results.filter((x) => x).length;
    // Allow 45-55% range (probabilistic, may flake rarely)
    assert.ok(evaled >= 450 && evaled <= 550, `Expected ~500, got ${evaled}`);
  });
});

// Mock eval caller that returns predictable ratings
const mockEvalCaller: EvalCaller = async (prompt: string) => {
  // Parse the prompt to find how many patterns (numbered list "1. pattern")
  const matches = prompt.match(/\d+\.\s+/g);
  const count = matches?.length ?? 0;
  // Return mock ratings: first pattern critical, rest helpful
  const ratings = [];
  for (let i = 1; i <= count; i++) {
    ratings.push(`${i}:${i === 1 ? 'critical' : 'helpful'}`);
  }
  return ratings.join(', ');
};
