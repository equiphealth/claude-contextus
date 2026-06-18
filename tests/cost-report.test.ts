import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

function setup(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cost-'));
}

function writeUsageLog(dir: string, events: object[]): string {
  const logDir = path.join(dir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'usage.jsonl');
  fs.writeFileSync(logPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return dir;
}

function makeRetrieval(
  overrides: Partial<{
    project: string;
    tokens_injected: number;
    prompt_tokens: number;
    retrieved: string[];
    timestamp: string;
  }> = {}
): object {
  return {
    type: 'retrieval',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    project: overrides.project ?? 'test-project',
    prompt_hash: 'abc12345',
    retrieved: overrides.retrieved ?? ['pattern-a.md'],
    tokens_injected: overrides.tokens_injected ?? 500,
    prompt_tokens: overrides.prompt_tokens ?? 2000,
    latency_ms: 120,
    similarity_scores: [0.72],
    floor_dropped: []
  };
}

function makeNoInject(
  overrides: Partial<{
    project: string;
    prompt_tokens: number;
    timestamp: string;
  }> = {}
): object {
  return {
    type: 'retrieval',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    project: overrides.project ?? 'test-project',
    prompt_hash: 'def67890',
    retrieved: [],
    tokens_injected: 0,
    prompt_tokens: overrides.prompt_tokens ?? 1500,
    latency_ms: 40,
    reason: 'below_floor',
    best_match_score: 0.32,
    floor_dropped: [{ pattern: 'something.md', similarity: 0.32 }]
  };
}

function makeCalibrationEval(
  overrides: Partial<{
    project: string;
    weighted_score: number;
    evaluations: Array<{ pattern: string; rating: string }>;
  }> = {}
): object {
  return {
    type: 'calibration_eval',
    timestamp: new Date().toISOString(),
    project: overrides.project ?? 'test-project',
    prompt_hash: 'cal12345',
    retrieved: ['pattern-a.md'],
    evaluations: overrides.evaluations ?? [{ pattern: 'pattern-a.md', rating: 'used' }],
    weighted_score: overrides.weighted_score ?? 0.75,
    evaluation_latency_ms: 800
  };
}

test('cost-report: computes overhead from prompt_tokens and tokens_injected', () => {
  const tmpDir = setup();
  const dataDir = writeUsageLog(tmpDir, [
    makeRetrieval({ prompt_tokens: 2000, tokens_injected: 200 }),
    makeRetrieval({ prompt_tokens: 3000, tokens_injected: 300 }),
    makeNoInject({ prompt_tokens: 1500 })
  ]);

  const result = execSync(`npx tsx scripts/cost-report.ts --json --days 30`, {
    encoding: 'utf8',
    env: { ...process.env, CONTEXTUS_LOG_DIR: path.join(dataDir, 'logs') }
  });
  const report = JSON.parse(result);

  assert.equal(report.queries.total, 3);
  assert.equal(report.queries.injected, 2);
  assert.equal(report.queries.skipped, 1);
  // overhead = 500 / 6500 = 7.7%
  assert.equal(report.tokens.totalInjectedTokens, 500);
  assert.equal(report.tokens.totalPromptTokens, 6500);
  assert.ok(report.tokens.overheadPercent > 7 && report.tokens.overheadPercent < 8);

  fs.rmSync(tmpDir, { recursive: true });
});

test('cost-report: includes calibration quality signal', () => {
  const tmpDir = setup();
  const dataDir = writeUsageLog(tmpDir, [
    makeRetrieval({ prompt_tokens: 2000, tokens_injected: 200 }),
    makeCalibrationEval({
      weighted_score: 0.8,
      evaluations: [
        { pattern: 'a.md', rating: 'used' },
        { pattern: 'b.md', rating: 'helpful' }
      ]
    }),
    makeCalibrationEval({
      weighted_score: 0.6,
      evaluations: [{ pattern: 'c.md', rating: 'unused' }]
    })
  ]);

  const result = execSync(`npx tsx scripts/cost-report.ts --json --days 30`, {
    encoding: 'utf8',
    env: { ...process.env, CONTEXTUS_LOG_DIR: path.join(dataDir, 'logs') }
  });
  const report = JSON.parse(result);

  assert.equal(report.quality.hasCalibration, true);
  assert.equal(report.quality.evalCount, 2);
  assert.equal(report.quality.avgWeightedScore, 0.7);
  assert.equal(report.quality.usageRatings.used, 1);
  assert.equal(report.quality.usageRatings.helpful, 1);
  assert.equal(report.quality.usageRatings.unused, 1);

  fs.rmSync(tmpDir, { recursive: true });
});

test('cost-report: handles empty log gracefully', () => {
  const tmpDir = setup();
  // Don't create any log file
  const result = execSync(`npx tsx scripts/cost-report.ts --json --days 30`, {
    encoding: 'utf8',
    env: { ...process.env, CONTEXTUS_LOG_DIR: path.join(tmpDir, 'logs') }
  });
  const parsed = JSON.parse(result);
  assert.equal(parsed.error, 'no_data');

  fs.rmSync(tmpDir, { recursive: true });
});

test('cost-report: handles missing prompt_tokens (pre-upgrade data)', () => {
  const tmpDir = setup();
  const events = [
    {
      type: 'retrieval',
      timestamp: new Date().toISOString(),
      project: 'old',
      prompt_hash: 'x',
      retrieved: ['a.md'],
      tokens_injected: 400,
      latency_ms: 100,
      similarity_scores: [0.6],
      floor_dropped: []
    }
  ];
  const dataDir = writeUsageLog(tmpDir, events);

  const result = execSync(`npx tsx scripts/cost-report.ts --json --days 30`, {
    encoding: 'utf8',
    env: { ...process.env, CONTEXTUS_LOG_DIR: path.join(dataDir, 'logs') }
  });
  const report = JSON.parse(result);

  assert.equal(report.tokens.totalPromptTokens, 0);
  assert.equal(report.tokens.overheadPercent, 0);
  assert.ok(report.costValue.summary.includes('not yet available'));

  fs.rmSync(tmpDir, { recursive: true });
});

test('cost-report: filters by project', () => {
  const tmpDir = setup();
  const dataDir = writeUsageLog(tmpDir, [
    makeRetrieval({ project: 'alpha', prompt_tokens: 2000, tokens_injected: 200 }),
    makeRetrieval({ project: 'beta', prompt_tokens: 3000, tokens_injected: 600 }),
    makeRetrieval({ project: 'alpha', prompt_tokens: 1000, tokens_injected: 100 })
  ]);

  const result = execSync(`npx tsx scripts/cost-report.ts --json --project alpha --days 30`, {
    encoding: 'utf8',
    env: { ...process.env, CONTEXTUS_LOG_DIR: path.join(dataDir, 'logs') }
  });
  const report = JSON.parse(result);

  assert.equal(report.queries.total, 2);
  assert.equal(report.tokens.totalInjectedTokens, 300);
  assert.equal(report.tokens.totalPromptTokens, 3000);
  assert.equal(report.project, 'alpha');

  fs.rmSync(tmpDir, { recursive: true });
});
