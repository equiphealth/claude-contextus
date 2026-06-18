import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRetrievalMissNotice,
  isNearMiss,
  extractNearTopics
} from '../lib/retrieval/miss-notice.js';

// --- isNearMiss ---

test('isNearMiss: true when score > 0.25 and dropped > 0', () => {
  assert.equal(isNearMiss(0.35, 2), true);
});

test('isNearMiss: false when score <= 0.25 (noise)', () => {
  assert.equal(isNearMiss(0.25, 3), false);
  assert.equal(isNearMiss(0.1, 1), false);
});

test('isNearMiss: false when no dropped candidates', () => {
  assert.equal(isNearMiss(0.4, 0), false);
});

test('isNearMiss: boundary at 0.26 is a near miss', () => {
  assert.equal(isNearMiss(0.26, 1), true);
});

// --- extractNearTopics ---

test('extractNearTopics: strips extension and converts separators', () => {
  const dropped = [
    { pattern: 'decision-use-logger-helper.md', similarity: 0.42 },
    { pattern: 'gotcha_embedding_switch.md', similarity: 0.38 }
  ];
  const topics = extractNearTopics(dropped);
  assert.deepEqual(topics, ['decision use logger helper', 'gotcha embedding switch']);
});

test('extractNearTopics: limits to 3 topics', () => {
  const dropped = [
    { pattern: 'a.md', similarity: 0.4 },
    { pattern: 'b.md', similarity: 0.39 },
    { pattern: 'c.md', similarity: 0.38 },
    { pattern: 'd.md', similarity: 0.37 },
    { pattern: 'e.md', similarity: 0.36 }
  ];
  assert.equal(extractNearTopics(dropped).length, 3);
});

test('extractNearTopics: handles empty array', () => {
  assert.deepEqual(extractNearTopics([]), []);
});

test('extractNearTopics: handles filenames without extension', () => {
  const dropped = [{ pattern: 'some-topic', similarity: 0.4 }];
  assert.deepEqual(extractNearTopics(dropped), ['some topic']);
});

// --- buildRetrievalMissNotice ---

test('buildRetrievalMissNotice: includes score and floor info', () => {
  const notice = buildRetrievalMissNotice(0.38, 0.45, ['logging patterns']);
  assert.ok(notice.includes('best: 0.38'));
  assert.ok(notice.includes('floor: 0.45'));
  assert.ok(notice.includes('gap: 7%'));
});

test('buildRetrievalMissNotice: includes near topics', () => {
  const notice = buildRetrievalMissNotice(0.4, 0.45, ['config hot reload', 'daemon lifecycle']);
  assert.ok(notice.includes('config hot reload, daemon lifecycle'));
});

test('buildRetrievalMissNotice: starts with contextus header', () => {
  const notice = buildRetrievalMissNotice(0.3, 0.45, ['test']);
  assert.ok(notice.startsWith('[contextus'));
});

test('buildRetrievalMissNotice: includes propose instruction', () => {
  const notice = buildRetrievalMissNotice(0.35, 0.45, ['test']);
  assert.ok(notice.includes('Context: propose:'));
});

test('buildRetrievalMissNotice: includes ask-the-user prompt', () => {
  const notice = buildRetrievalMissNotice(0.35, 0.45, ['test']);
  assert.ok(notice.includes('ask the user'));
  assert.ok(notice.includes('context pattern for future sessions'));
});

test('buildRetrievalMissNotice: handles unknown topics gracefully', () => {
  const notice = buildRetrievalMissNotice(0.3, 0.45, []);
  assert.ok(notice.includes('unknown'));
});

test('buildRetrievalMissNotice: gap calculation is correct', () => {
  const notice = buildRetrievalMissNotice(0.32, 0.45, ['x']);
  assert.ok(notice.includes('gap: 13%'));
});

test('buildRetrievalMissNotice: mentions two possible explanations', () => {
  const notice = buildRetrievalMissNotice(0.4, 0.45, ['x']);
  assert.ok(notice.includes("doesn't cover this angle"));
  assert.ok(notice.includes('genuinely new topic'));
});
