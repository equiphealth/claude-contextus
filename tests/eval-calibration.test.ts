/**
 * Calibration eval unit tests — the PARSER is the mandated test target (Phase 5:
 * "test the parser, mock the model call"). Covers the compact reply format, prose
 * tolerance, index mapping, out-of-range/dup handling, and the weighted score.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvalPrompt,
  parseEvalResponse,
  weightedScore,
  RATING_WEIGHTS,
  type InjectedPattern,
} from '../lib/eval-calibration.js';

const PATTERNS: InjectedPattern[] = [
  { id: 'logger-helper.md', snippet: 'log retry attempts' },
  { id: 'test-data-setup.md', snippet: 'fixtures isolate state' },
  { id: 'appium-timeout.md', snippet: 'bump implicit wait' },
];

test('buildEvalPrompt: numbers patterns and includes thinking + response', () => {
  const p = buildEvalPrompt('how to retry?', 'I will use logger-helper', 'add retry logic', PATTERNS);
  assert.match(p, /1\. logger-helper\.md/);
  assert.match(p, /3\. appium-timeout\.md/);
  assert.match(p, /Claude's thinking: I will use logger-helper/);
  assert.match(p, /Claude's response: add retry logic/);
});

test('buildEvalPrompt: missing thinking is labeled, not blank', () => {
  const p = buildEvalPrompt('q', '', 'r', PATTERNS);
  assert.match(p, /Claude's thinking: \(none captured\)/);
});

test('parse: canonical "n:rating" comma list maps to pattern ids', () => {
  const out = parseEvalResponse('1:critical, 2:helpful, 3:unused', PATTERNS);
  assert.deepEqual(out, [
    { pattern: 'logger-helper.md', rating: 'critical' },
    { pattern: 'test-data-setup.md', rating: 'helpful' },
    { pattern: 'appium-timeout.md', rating: 'unused' },
  ]);
});

test('parse: tolerates prose, varied spacing, and case', () => {
  const out = parseEvalResponse(
    'Sure! Here you go: 1 : CRITICAL and 2:Mentioned. The rest (3: unused).',
    PATTERNS
  );
  assert.deepEqual(out, [
    { pattern: 'logger-helper.md', rating: 'critical' },
    { pattern: 'test-data-setup.md', rating: 'mentioned' },
    { pattern: 'appium-timeout.md', rating: 'unused' },
  ]);
});

test('parse: out-of-range indices are dropped', () => {
  const out = parseEvalResponse('1:critical, 9:helpful, 0:critical', PATTERNS);
  assert.deepEqual(out, [{ pattern: 'logger-helper.md', rating: 'critical' }]);
});

test('parse: repeated index keeps the LAST rating (self-correction wins)', () => {
  const out = parseEvalResponse('1:unused, 1:critical', PATTERNS);
  assert.deepEqual(out, [{ pattern: 'logger-helper.md', rating: 'critical' }]);
});

test('parse: empty / junk input → no ratings', () => {
  assert.deepEqual(parseEvalResponse('', PATTERNS), []);
  assert.deepEqual(parseEvalResponse('no ratings here', PATTERNS), []);
});

test('weightedScore: LOGGING.md formula over total RETRIEVED, not rated', () => {
  // 1 critical (1.0) + 1 helpful (0.7) over 3 retrieved = 1.7/3
  const ratings = [
    { pattern: 'logger-helper.md', rating: 'critical' as const },
    { pattern: 'test-data-setup.md', rating: 'helpful' as const },
  ];
  assert.ok(Math.abs(weightedScore(ratings, 3) - 1.7 / 3) < 1e-9);
});

test('weightedScore: unrated patterns count as unused (denominator = retrieved)', () => {
  // only 1 of 3 graded → score reflects the 2 silent unused
  const ratings = [{ pattern: 'logger-helper.md', rating: 'critical' as const }];
  assert.ok(Math.abs(weightedScore(ratings, 3) - 1 / 3) < 1e-9);
});

test('weightedScore: zero retrieved → 0 (no divide-by-zero)', () => {
  assert.equal(weightedScore([], 0), 0);
});

test('RATING_WEIGHTS: matches the documented schedule', () => {
  assert.deepEqual(RATING_WEIGHTS, { critical: 1.0, helpful: 0.7, mentioned: 0.3, unused: 0.0 });
});
