/**
 * Staleness unit tests — content-hash detection drives incremental-embed skips.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, isStale } from '../lib/staleness.js';

test('contentHash: stable + ignores surrounding whitespace', () => {
  assert.equal(contentHash('hello'), contentHash('hello'));
  assert.equal(contentHash('  hello\n'), contentHash('hello'));
  assert.notEqual(contentHash('hello'), contentHash('goodbye'));
});

test('contentHash: full-length sha256 hex (64 chars)', () => {
  assert.match(contentHash('x'), /^[0-9a-f]{64}$/);
});

test('isStale: missing/empty stored hash is always stale (never embedded)', () => {
  assert.equal(isStale(undefined, 'body'), true);
  assert.equal(isStale(null, 'body'), true);
  assert.equal(isStale('', 'body'), true);
});

test('isStale: equal content → fresh (skip the re-embed)', () => {
  const h = contentHash('the body');
  assert.equal(isStale(h, 'the body'), false);
  assert.equal(isStale(h, '  the body  '), false); // whitespace-insensitive
});

test('isStale: changed content → stale (must re-embed)', () => {
  const h = contentHash('original');
  assert.equal(isStale(h, 'edited'), true);
});
