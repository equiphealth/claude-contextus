/**
 * Eval worker core test — the model call is MOCKED (Phase 5 brief). Proves the
 * job → call → parse → score path returns the right weighted score, and that a
 * model failure propagates (so drainQueue can drop+continue rather than wedge).
 *
 * We don't assert on the logged file here (logging is best-effort I/O to
 * ~/.contextus); we assert on processJob's return, which carries the graded
 * result. Queue file orchestration is covered by Phase-6 integration tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processJob, type EvalJob } from '../lib/calibration/eval-worker-core.js';
import type { EvalModelConfig } from '../lib/calibration/eval-model.js';

const MODEL: EvalModelConfig = { provider: 'ollama', model: 'test' };

function job(overrides: Partial<EvalJob> = {}): EvalJob {
  return {
    project: 'demo',
    promptHash: 'abc123',
    prompt: '',
    thinking: 'I will lean on logger-helper here, the others are off-topic',
    response: 'Add retry logic with structured logging.',
    patterns: [
      { id: 'logger-helper.md', snippet: 'log retries' },
      { id: 'unrelated.md', snippet: 'something else' },
    ],
    enqueuedAt: new Date('2026-06-14T00:00:00.000Z').toISOString(),
    ...overrides,
  };
}

test('processJob: mocked caller → parsed, scored result', async () => {
  let sawPrompt = '';
  const caller = async (prompt: string) => {
    sawPrompt = prompt;
    return '1:critical, 2:unused';
  };
  const res = await processJob(job(), MODEL, caller, () => Date.parse('2026-06-14T00:00:00.234Z'));
  // 1 critical (1.0) of 2 retrieved → 0.5
  assert.equal(res.weightedScore, 0.5);
  assert.equal(res.rated, 2);
  // the prompt the model saw actually contains the injected pattern list
  assert.match(sawPrompt, /logger-helper\.md/);
});

test('processJob: unparseable reply → score 0, zero rated (treated as all-unused)', async () => {
  const caller = async () => 'I have no idea, sorry';
  const res = await processJob(job(), MODEL, caller);
  assert.equal(res.weightedScore, 0);
  assert.equal(res.rated, 0);
});

test('processJob: model error propagates (caller rejects)', async () => {
  const caller = async () => {
    throw new Error('model 500');
  };
  await assert.rejects(() => processJob(job(), MODEL, caller), /model 500/);
});

test('processJob: latency derived from enqueuedAt; bad timestamp → 0', async () => {
  const caller = async () => '1:helpful';
  const res = await processJob(
    job({ enqueuedAt: 'not-a-date' }),
    MODEL,
    caller,
    () => 999_999
  );
  // helpful (0.7) of 2 → 0.35
  assert.ok(Math.abs(res.weightedScore - 0.35) < 1e-9);
});
