import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldExpand } from '../lib/retrieval/expand.js';

test('shouldExpand: off mode always returns false', () => {
  assert.equal(shouldExpand('off', 0.2, 0.55), false);
  assert.equal(shouldExpand('off', 0.9, 0.55), false);
});

test('shouldExpand: always mode always returns true', () => {
  assert.equal(shouldExpand('always', 0.2, 0.55), true);
  assert.equal(shouldExpand('always', 0.9, 0.55), true);
});

test('shouldExpand: adaptive fires when best score is below threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.4, 0.55), true);
  assert.equal(shouldExpand('adaptive', 0.54, 0.55), true);
});

test('shouldExpand: adaptive does not fire when best score meets threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.55, 0.55), false);
  assert.equal(shouldExpand('adaptive', 0.7, 0.55), false);
});

test('shouldExpand: adaptive with custom threshold', () => {
  assert.equal(shouldExpand('adaptive', 0.6, 0.65), true);
  assert.equal(shouldExpand('adaptive', 0.66, 0.65), false);
});
