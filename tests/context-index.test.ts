/**
 * upsertIndexEntry — CONTEXT.md/DOCS.md index upsert logic (equiphealth/claude-contextus,
 * duplicate-index-entries-on-recapture fix). Pure string transform, no filesystem.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertIndexEntry } from '../lib/capture/context-index.js';

test('upsertIndexEntry: appends a new entry when the file has no matching link', () => {
  const before = '# Context Index\n\n- [foo](decisions/decision-foo.md) — Foo\n';
  const result = upsertIndexEntry(
    before,
    'decisions/decision-bar.md',
    '- [bar](decisions/decision-bar.md) — Bar'
  );
  assert.equal(
    result,
    '# Context Index\n\n- [foo](decisions/decision-foo.md) — Foo\n- [bar](decisions/decision-bar.md) — Bar\n'
  );
});

test('upsertIndexEntry: replaces the existing line in place on re-capture (no duplicate)', () => {
  const before =
    '# Context Index\n\n- [foo](decisions/decision-foo.md) — Old description\n- [bar](decisions/decision-bar.md) — Bar\n';
  const result = upsertIndexEntry(
    before,
    'decisions/decision-foo.md',
    '- [foo](decisions/decision-foo.md) — New description'
  );
  const lines = result.split('\n');
  const fooLines = lines.filter((l) => l.includes('decision-foo.md'));
  assert.equal(fooLines.length, 1, 'must not duplicate the entry');
  assert.equal(fooLines[0], '- [foo](decisions/decision-foo.md) — New description');
  // bar entry untouched
  assert.ok(result.includes('- [bar](decisions/decision-bar.md) — Bar'));
});

test('upsertIndexEntry: repeated re-capture of the same slug never accumulates duplicates', () => {
  let content = '# Context Index\n\n';
  for (let i = 0; i < 5; i++) {
    content = upsertIndexEntry(
      content,
      'gotchas/gotcha-x.md',
      `- [x](gotchas/gotcha-x.md) — Version ${i}`
    );
  }
  const matches = content.split('\n').filter((l) => l.includes('gotcha-x.md'));
  assert.equal(matches.length, 1, 'five recaptures must still leave exactly one entry');
  assert.equal(matches[0], '- [x](gotchas/gotcha-x.md) — Version 4');
});

test('upsertIndexEntry: cleans up PRE-EXISTING duplicates, not just future ones', () => {
  const before = [
    '# Context Index',
    '',
    '- [foo](decisions/decision-foo.md) — v1',
    '- [bar](decisions/decision-bar.md) — Bar',
    '- [foo](decisions/decision-foo.md) — v2',
    '- [baz](decisions/decision-baz.md) — Baz',
    '- [foo](decisions/decision-foo.md) — v3',
    ''
  ].join('\n');

  const result = upsertIndexEntry(
    before,
    'decisions/decision-foo.md',
    '- [foo](decisions/decision-foo.md) — latest'
  );

  const fooLines = result.split('\n').filter((l) => l.includes('decision-foo.md'));
  assert.equal(fooLines.length, 1, 'all 3 pre-existing duplicates collapse to 1');
  assert.equal(fooLines[0], '- [foo](decisions/decision-foo.md) — latest');
  // unrelated entries survive, in their original relative order
  assert.ok(result.includes('- [bar](decisions/decision-bar.md) — Bar'));
  assert.ok(result.includes('- [baz](decisions/decision-baz.md) — Baz'));
  const barIdx = result.indexOf('decision-bar.md');
  const bazIdx = result.indexOf('decision-baz.md');
  assert.ok(barIdx < bazIdx, 'bar must still come before baz');
});

test('upsertIndexEntry: does not match a different file with a similar relPath', () => {
  const before = '- [foo](decisions/decision-foo-bar.md) — Foo Bar\n';
  const result = upsertIndexEntry(
    before,
    'decisions/decision-foo.md',
    '- [foo](decisions/decision-foo.md) — Foo'
  );
  // Both entries must exist — decision-foo.md is NOT a substring match of decision-foo-bar.md's link target
  assert.ok(result.includes('decision-foo-bar.md'));
  assert.ok(result.includes('](decisions/decision-foo.md)'));
  const lines = result.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 2);
});

test('upsertIndexEntry: handles empty existing content', () => {
  const result = upsertIndexEntry(
    '',
    'decisions/decision-foo.md',
    '- [foo](decisions/decision-foo.md) — Foo'
  );
  assert.equal(result, '- [foo](decisions/decision-foo.md) — Foo\n');
});

test('upsertIndexEntry: appends without a stray blank line when content already ends with newline', () => {
  const before = '- [a](a.md) — A\n';
  const result = upsertIndexEntry(before, 'b.md', '- [b](b.md) — B');
  assert.equal(result, '- [a](a.md) — A\n- [b](b.md) — B\n');
});
