/**
 * Unit tests for lib/debug-statusline.ts — the per-session snapshot that backs
 * the opt-in verbose debug statusline (scripts/install-debug-statusline.sh).
 *
 * HOME is redirected to a throwaway temp dir BEFORE importing the module,
 * since RUNTIME_DIR is computed once at module-load time from expandHome().
 * readRecentUsageRatings() re-resolves its path per call, so it's safe to
 * point at a fresh per-test HOME too, but doing it once up top keeps this
 * file consistent with the integration-test pattern used elsewhere.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-debugstatusline-home-'));
process.env.HOME = homeDir;

const { computeRecentUsefulPct, readRecentUsageRatings, writeLastInjectionDebug } =
  await import('../lib/debug-statusline.js');

after(() => {
  fs.rmSync(homeDir, { recursive: true, force: true });
});

test('computeRecentUsefulPct: no ratings → null pct, 0 samples', () => {
  const { pct, samples } = computeRecentUsefulPct([]);
  assert.equal(pct, null);
  assert.equal(samples, 0);
});

test('computeRecentUsefulPct: averages weightedScore and rounds to an integer percent', () => {
  const { pct, samples } = computeRecentUsefulPct([
    { weightedScore: 0.9 },
    { weightedScore: 0.8 },
    { weightedScore: 0.7 }
  ]);
  assert.equal(samples, 3);
  assert.equal(pct, 80); // (0.9+0.8+0.7)/3 = 0.8 -> 80
});

test('computeRecentUsefulPct: single rating', () => {
  const { pct, samples } = computeRecentUsefulPct([{ weightedScore: 0.55 }]);
  assert.equal(samples, 1);
  assert.equal(pct, 55);
});

const projectId = 'testproj123';
let ratingsPath: string;

beforeEach(() => {
  ratingsPath = path.join(homeDir, '.contextus', 'data', projectId, 'usage-ratings.jsonl');
  fs.mkdirSync(path.dirname(ratingsPath), { recursive: true });
  if (fs.existsSync(ratingsPath)) fs.rmSync(ratingsPath);
});

test('readRecentUsageRatings: missing file returns empty array (no throw)', () => {
  const result = readRecentUsageRatings('does-not-exist-project');
  assert.deepEqual(result, []);
});

test('readRecentUsageRatings: reads back written ratings in order', () => {
  const lines = [{ weightedScore: 0.5 }, { weightedScore: 0.6 }, { weightedScore: 0.7 }];
  fs.writeFileSync(ratingsPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const result = readRecentUsageRatings(projectId);
  assert.deepEqual(result, lines);
});

test('readRecentUsageRatings: respects the window, keeping only the most recent N', () => {
  const lines = Array.from({ length: 15 }, (_, i) => ({ weightedScore: i / 100 }));
  fs.writeFileSync(ratingsPath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const result = readRecentUsageRatings(projectId, 5);
  assert.equal(result.length, 5);
  // last 5 of 0..14 are indices 10..14
  assert.deepEqual(result, lines.slice(-5));
});

test('readRecentUsageRatings: skips malformed/torn lines instead of throwing', () => {
  const content = [
    JSON.stringify({ weightedScore: 0.4 }),
    '{not valid json',
    JSON.stringify({ weightedScore: 0.6 }),
    JSON.stringify({ notAWeightedScore: 'oops' }) // valid JSON, wrong shape — should be skipped
  ].join('\n');
  fs.writeFileSync(ratingsPath, content);

  const result = readRecentUsageRatings(projectId);
  assert.deepEqual(result, [{ weightedScore: 0.4 }, { weightedScore: 0.6 }]);
});

test('writeLastInjectionDebug: writes a snapshot file keyed by sessionId', () => {
  const sessionId = 'session-abc';
  writeLastInjectionDebug(sessionId, projectId, {
    project: 'my-project',
    injected: true,
    count: 3,
    candidates: 12,
    bestScore: 0.812,
    floor: 0.725,
    topK: 5,
    tokensInjected: 842,
    latencyMs: 214,
    expansion: 'skipped',
    hybrid: 'off',
    capacityTier: 'none',
    sources: { projectContext: 2, userContext: 1 }
  });

  const snapshotPath = path.join(
    homeDir,
    '.contextus',
    'runtime',
    `${sessionId}.last-injection.json`
  );
  assert.ok(fs.existsSync(snapshotPath));
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  assert.equal(snapshot.injected, true);
  assert.equal(snapshot.count, 3);
  assert.equal(snapshot.sources.projectContext, 2);
  assert.equal(typeof snapshot.timestamp, 'number');
  // no ratings written for this project in this test -> null/0
  assert.equal(snapshot.recentUsefulPct, null);
  assert.equal(snapshot.recentUsefulSamples, 0);
});

test('writeLastInjectionDebug: folds in the rolling recentUsefulPct from usage-ratings.jsonl', () => {
  fs.writeFileSync(
    ratingsPath,
    [{ weightedScore: 1.0 }, { weightedScore: 0.5 }].map((l) => JSON.stringify(l)).join('\n') + '\n'
  );

  const sessionId = 'session-with-ratings';
  writeLastInjectionDebug(sessionId, projectId, {
    project: 'my-project',
    injected: false,
    count: 0,
    candidates: 4,
    bestScore: 0.5,
    floor: 0.725,
    topK: 5,
    tokensInjected: 0,
    latencyMs: 50,
    expansion: 'off',
    hybrid: 'off',
    capacityTier: 'none',
    sources: {}
  });

  const snapshotPath = path.join(
    homeDir,
    '.contextus',
    'runtime',
    `${sessionId}.last-injection.json`
  );
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  assert.equal(snapshot.recentUsefulPct, 75); // (1.0 + 0.5) / 2 = 0.75 -> 75
  assert.equal(snapshot.recentUsefulSamples, 2);
});

test('writeLastInjectionDebug: no-op (no throw) when sessionId is undefined', () => {
  assert.doesNotThrow(() => {
    writeLastInjectionDebug(undefined, projectId, {
      project: 'my-project',
      injected: false,
      count: 0,
      candidates: 0,
      bestScore: 0,
      floor: 0.725,
      topK: 5,
      tokensInjected: 0,
      latencyMs: 10,
      expansion: 'off',
      hybrid: 'off',
      capacityTier: 'none',
      sources: {}
    });
  });
});
