/**
 * Tag-frontmatter writer tests — idempotent, structure-preserving tag backfill
 * (the /tag-context engine). Pure logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import matter from 'gray-matter';
import { addTags } from '../lib/capture/tag-frontmatter.js';

const NESTED = `---
name: foo
description: a thing
metadata:
  type: decision
---

Body stays put.
`;

const TOPLEVEL = `---
name: bar
type: reference
---

Other body.
`;

test('addTags: writes into metadata.tags when the file uses nested metadata', () => {
  const r = addTags(NESTED, ['lancedb', 'api']);
  assert.equal(r.changed, true);
  assert.deepEqual(r.added, ['lancedb', 'api']);
  const { data, content } = matter(r.content);
  assert.deepEqual((data.metadata as Record<string, unknown>).tags, ['lancedb', 'api']);
  assert.match(content, /Body stays put\./);
  assert.equal((data.metadata as Record<string, unknown>).type, 'decision', 'type preserved');
});

test('addTags: writes top-level tags when there is no metadata block', () => {
  const r = addTags(TOPLEVEL, ['gotcha']);
  const { data } = matter(r.content);
  assert.deepEqual(data.tags, ['gotcha']);
  assert.equal(data.type, 'reference', 'sibling key preserved');
});

test('addTags: idempotent — adding present tags is a no-op', () => {
  const once = addTags(NESTED, ['lancedb', 'api']).content;
  const twice = addTags(once, ['lancedb', 'api']);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.content, once);
});

test('addTags: merges new tags with existing, dedups', () => {
  const seeded = addTags(NESTED, ['a', 'b']).content;
  const r = addTags(seeded, ['b', 'c']);
  assert.deepEqual(r.added, ['c'], 'only the genuinely-new tag is added');
  const { data } = matter(r.content);
  assert.deepEqual((data.metadata as Record<string, unknown>).tags, ['a', 'b', 'c']);
});

test('addTags: trims and drops empty tags', () => {
  const r = addTags(NESTED, ['  spaced  ', '', '   ']);
  assert.deepEqual(r.added, ['spaced']);
});
