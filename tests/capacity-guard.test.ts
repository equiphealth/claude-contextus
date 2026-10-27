/**
 * Capacity guard unit tests — host-neutral daemon core.
 *
 * `capacityPercent` resolves a capacity percentage from hook-reported stats
 * (explicit `used_percentage` from the Claude statusline path, or cumulative
 * `input_tokens` against an explicitly configured `contextWindowTokens` such
 * as the Muse PostLLMCall accumulator writes). `capacityTierFor` maps the
 * percentage to a guard tier. Pure functions, no daemon needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capacityPercent, capacityTierFor } from '../daemon/server.js';

test('capacityPercent: explicit used_percentage wins', () => {
  assert.equal(capacityPercent({ used_percentage: 72 }, undefined), 72);
  assert.equal(
    capacityPercent({ used_percentage: 72, input_tokens: 999999 }, { contextWindowTokens: 100000 }),
    72
  );
});

test('capacityPercent: cumulative input_tokens against explicit window', () => {
  assert.equal(capacityPercent({ input_tokens: 50000 }, { contextWindowTokens: 100000 }), 50);
});

test('capacityPercent: no guessing without a configured window', () => {
  assert.equal(capacityPercent({ input_tokens: 50000 }, undefined), undefined);
  assert.equal(capacityPercent({ input_tokens: 50000 }, {}), undefined);
  assert.equal(capacityPercent(undefined, { contextWindowTokens: 100000 }), undefined);
  assert.equal(capacityPercent({}, { contextWindowTokens: 100000 }), undefined);
});

test('capacityTierFor: thresholds and fail-open', () => {
  const cp = { disableAt: 85, minimalAt: 80, reduceAt: 70 };
  assert.equal(capacityTierFor(90, cp, true), 'disabled');
  assert.equal(capacityTierFor(82, cp, true), 'minimal');
  assert.equal(capacityTierFor(75, cp, true), 'reduced');
  assert.equal(capacityTierFor(50, cp, true), 'none');
  assert.equal(capacityTierFor(undefined, cp, true), 'none');
  assert.equal(capacityTierFor(95, cp, false), 'none');
  assert.equal(capacityTierFor(95, undefined, true), 'disabled');
});
