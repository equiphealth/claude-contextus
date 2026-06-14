/**
 * Floor-calibration unit tests — percentile math, coverage, and the floor
 * recommendation (the Phase-5 exit logic). Pure stats, no embeddings.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  percentile,
  coverage,
  buildCoverageCurve,
  recommendFloor,
  type ReplayResult,
} from '../lib/floor-calibration.js';

test('percentile: endpoints and interpolation', () => {
  const xs = [0, 1, 2, 3, 4];
  assert.equal(percentile(xs, 0), 0);
  assert.equal(percentile(xs, 100), 4);
  assert.equal(percentile(xs, 50), 2);
  assert.equal(percentile(xs, 25), 1);
});

test('percentile: degenerate inputs', () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([0.42], 90), 0.42);
});

test('coverage: share of values at/above floor', () => {
  assert.equal(coverage([0.1, 0.2, 0.3, 0.4], 0.25), 0.5);
  assert.equal(coverage([0.5, 0.6], 0.7), 0);
  assert.equal(coverage([], 0.5), 0);
});

test('buildCoverageCurve: monotonically non-increasing injection rate as floor rises', () => {
  const top1s = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  const curve = buildCoverageCurve(top1s);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i].injectionRate <= curve[i - 1].injectionRate);
  }
  assert.equal(curve[0].floor, 0.05);
});

test('recommendFloor: places floor in the noise/signal gap (bimodal distribution)', () => {
  // a noise cloud near 0.1–0.2 and a real-match cluster near 0.6–0.7, with a
  // wide gap between them — the floor should land IN the gap, not in the noise.
  const noise = [0.08, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22];
  const signal = [0.6, 0.63, 0.66, 0.69];
  const results: ReplayResult[] = [...noise, ...signal].map((top1) => ({ top1, top2: null }));
  const rec = recommendFloor(results);
  assert.ok(
    rec.recommendedFloor > 0.22 && rec.recommendedFloor < 0.6,
    `floor ${rec.recommendedFloor} should sit in the 0.22–0.6 gap`
  );
  // only the signal cluster injects → ~4/12
  assert.ok(rec.coverageAtFloor <= 0.4);
  assert.match(rec.rationale, /gap|boundary|noise/i);
  assert.ok(rec.coverageCurve.length > 0);
});

test('recommendFloor: smooth distribution → falls back to ~p75', () => {
  // evenly spaced with sub-0.05 gaps → no clear cluster → fallback to ~p75
  const results: ReplayResult[] = Array.from({ length: 40 }, (_, i) => ({
    top1: i / 40, // 0.0 … 0.975, uniform 0.025 spacing (< 0.05 gap threshold)
    top2: null,
  }));
  const rec = recommendFloor(results);
  assert.ok(Math.abs(rec.recommendedFloor - rec.top1Percentiles.p75) < 0.05);
});

test('recommendFloor: empty corpus → permissive fallback, never throws', () => {
  const rec = recommendFloor([
    { top1: null, top2: null },
    { top1: null, top2: null },
  ]);
  assert.equal(rec.sampled, 0);
  assert.equal(rec.emptyResults, 2);
  assert.equal(rec.recommendedFloor, 0.35);
  assert.match(rec.rationale, /empty corpus|permissive|recalibrate/i);
});

test('recommendFloor: floor is clamped into [0.05, 0.95]', () => {
  // all near-zero top-1 → p10-0.02 would go negative, clamp to 0.05
  const low = recommendFloor([0.01, 0.02, 0.03].map((t) => ({ top1: t, top2: null })));
  assert.ok(low.recommendedFloor >= 0.05);
});

test('recommendFloor: mixed empties counted but excluded from the distribution', () => {
  const results: ReplayResult[] = [
    { top1: 0.6, top2: 0.2 },
    { top1: null, top2: null },
    { top1: 0.5, top2: 0.1 },
  ];
  const rec = recommendFloor(results);
  assert.equal(rec.sampled, 2);
  assert.equal(rec.emptyResults, 1);
});
