/**
 * Novelty-signal tests — the in-memory recently-injected ring the awareness hook
 * reads via /novelty. Per-project, bounded, dedupe-to-most-recent.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordInjection,
  noveltyFor,
  resetNovelty,
  NOVELTY_WINDOW
} from '../lib/capture/novelty.js';

beforeEach(() => resetNovelty());

test('noveltyFor: empty for an unseen project', () => {
  assert.deepEqual(noveltyFor('nope'), []);
});

test('recordInjection: accumulates injected patterns oldest→newest', () => {
  recordInjection('p', ['a.md']);
  recordInjection('p', ['b.md']);
  assert.deepEqual(noveltyFor('p'), ['a.md', 'b.md']);
});

test('recordInjection: re-injected pattern floats to most-recent (no dupes)', () => {
  recordInjection('p', ['a.md', 'b.md']);
  recordInjection('p', ['a.md']);
  assert.deepEqual(noveltyFor('p'), ['b.md', 'a.md']);
});

test('recordInjection: isolated per project', () => {
  recordInjection('p1', ['a.md']);
  recordInjection('p2', ['z.md']);
  assert.deepEqual(noveltyFor('p1'), ['a.md']);
  assert.deepEqual(noveltyFor('p2'), ['z.md']);
});

test('recordInjection: bounded to NOVELTY_WINDOW (keeps most recent)', () => {
  for (let i = 0; i < NOVELTY_WINDOW + 5; i++) recordInjection('p', [`f${i}.md`]);
  const recent = noveltyFor('p');
  assert.equal(recent.length, NOVELTY_WINDOW);
  assert.equal(recent[recent.length - 1], `f${NOVELTY_WINDOW + 4}.md`);
  assert.equal(recent[0], `f5.md`);
});

test('recordInjection: empty list is a no-op', () => {
  recordInjection('p', []);
  assert.deepEqual(noveltyFor('p'), []);
});
