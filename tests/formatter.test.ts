/**
 * Injection-formatter unit tests — header/attribution, budget trimming, the
 * "always admit the top chunk" rule, similarity + hit-count rendering.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatInjection,
  estimateTokens,
  renderFooterInstruction,
} from '../lib/retrieval/inject-format.js';
import type { RankedResult } from '../lib/retrieval/reranker.js';

function chunk(id: string, body: string, similarity = 0.5, hit_count = 0): RankedResult {
  return {
    id,
    vector: [],
    document: body,
    filename: `${id}.md`,
    chunk_index: 0,
    heading: '',
    type: 'reference',
    source: 'projectContext',
    tags: '',
    hit_count,
    last_hit: '',
    updated_at: '',
    distance: 0,
    similarity,
    finalScore: similarity,
  };
}

test('formatInjection: empty input → empty block', () => {
  const r = formatInjection([], 3000);
  assert.equal(r.block, '');
  assert.equal(r.included.length, 0);
});

test('formatInjection: includes the contextus attribution header', () => {
  const r = formatInjection([chunk('a', 'hello')], 3000);
  assert.match(r.block, /\[contextus —/);
});

test('formatInjection: renders filename and type via default template', () => {
  const r = formatInjection([chunk('a', 'body', 0.4783, 3)], 3000);
  assert.match(r.block, /\*\*a\.md\*\*/);
  assert.match(r.block, /_reference_/);
});

test('formatInjection: includes body content', () => {
  const r = formatInjection([chunk('a', 'body content here', 0.5, 0)], 3000);
  assert.match(r.block, /body content here/);
});

test('formatInjection: always admits the top chunk even if over budget', () => {
  const big = chunk('big', 'x'.repeat(10000)); // ~2500 tokens alone
  const r = formatInjection([big], 100); // tiny budget
  assert.equal(r.included.length, 1);
  assert.equal(r.included[0].id, 'big');
  assert.equal(r.budgetDropped.length, 0);
});

test('formatInjection: drops later chunks that blow the budget, keeps order', () => {
  const a = chunk('a', 'a'.repeat(360)); // ~90 tokens
  const b = chunk('b', 'b'.repeat(360));
  const c = chunk('c', 'c'.repeat(360));
  const r = formatInjection([a, b, c], 120); // header + a fits, b/c don't
  assert.deepEqual(
    r.included.map((x) => x.id),
    ['a']
  );
  assert.deepEqual(
    r.budgetDropped.map((x) => x.id),
    ['b', 'c']
  );
});

test('estimateTokens: ~4 chars per token', () => {
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens(''), 0);
});

test('renderFooterInstruction: empty input → empty string (no footer when nothing injected)', () => {
  assert.equal(renderFooterInstruction([]), '');
});

test('renderFooterInstruction: whitelists exactly the injected files + scores', () => {
  const s = renderFooterInstruction([chunk('a', 'x', 0.82), chunk('b', 'y', 0.51)]);
  assert.match(s, /a\.md \(0\.82\)/);
  assert.match(s, /b\.md \(0\.51\)/);
  // It must instruct against fabrication — the whole point of the deterministic fix.
  assert.match(s, /Never write a filename or score not in this list/);
  assert.match(s, /Context: used:/);
});

test('renderFooterInstruction: a file NOT injected never appears in the instruction', () => {
  const s = renderFooterInstruction([chunk('real-pattern', 'x', 0.6)]);
  assert.match(s, /real-pattern\.md/);
  // The hallucinated file from the 2026-06-15 session must not be derivable from here.
  assert.doesNotMatch(s, /platform-aware/);
});
