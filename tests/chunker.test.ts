/**
 * Chunker unit tests — header splitting, token-fallback windows + overlap,
 * heading re-attachment, empty input. (v1 logic, not yet pipeline-wired.)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkMarkdown, estimateTokens } from '../lib/chunker.js';

test('chunkMarkdown: empty/whitespace input → no chunks', () => {
  assert.deepEqual(chunkMarkdown(''), []);
  assert.deepEqual(chunkMarkdown('   \n  \n'), []);
});

test('chunkMarkdown: splits on markdown headers, one chunk per section', () => {
  const md = `# A\nalpha body\n\n# B\nbeta body`;
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'A');
  assert.equal(chunks[1].heading, 'B');
  assert.match(chunks[0].text, /alpha body/);
});

test('chunkMarkdown: preamble before first header becomes a heading-less chunk', () => {
  const md = `intro text\n\n# Section\nbody`;
  const chunks = chunkMarkdown(md);
  assert.equal(chunks[0].heading, '');
  assert.match(chunks[0].text, /intro text/);
  assert.equal(chunks[1].heading, 'Section');
});

test('chunkMarkdown: indexes are sequential', () => {
  const chunks = chunkMarkdown(`# A\na\n# B\nb\n# C\nc`);
  assert.deepEqual(
    chunks.map((c) => c.index),
    [0, 1, 2]
  );
});

test('chunkMarkdown: over-long section is token-split into multiple windows', () => {
  const longBody = 'word '.repeat(2000); // ~2500 tokens, well over 512
  const chunks = chunkMarkdown(`# Big\n${longBody}`, { maxTokens: 512, overlap: 64 });
  assert.ok(chunks.length > 1, 'expected multiple windows');
  for (const c of chunks) {
    assert.ok(estimateTokens(c.text) <= 512 + 1, `chunk within budget: ${estimateTokens(c.text)}`);
    assert.equal(c.heading, 'Big');
  }
});

test('chunkMarkdown: windows overlap (a boundary word appears in two chunks)', () => {
  // Distinct numbered tokens so we can detect shared content across windows.
  const body = Array.from({ length: 800 }, (_, i) => `t${i}`).join(' ');
  const chunks = chunkMarkdown(`# H\n${body}`, { maxTokens: 200, overlap: 40 });
  assert.ok(chunks.length >= 2);
  const firstWords = new Set(chunks[0].text.split(/\s+/));
  const secondWords = chunks[1].text.split(/\s+/);
  const shared = secondWords.filter((w) => firstWords.has(w) && /^t\d+$/.test(w));
  assert.ok(shared.length > 0, 'expected overlap between consecutive windows');
});
