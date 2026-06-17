/**
 * CLAUDE.md stanza upsert tests — the idempotency that lets /contextus-setup be
 * re-run safely (the Phase-6 exit criterion: re-running never duplicates the
 * stanza). Pure logic.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertStanza,
  hasStanza,
  renderStanza,
  STANZA_START,
  STANZA_END
} from '../lib/capture/claude-md-stanza.js';

function countOccurrences(s: string, sub: string): number {
  return s.split(sub).length - 1;
}

test('append: empty file gets exactly one stanza, no leading blank lines', () => {
  const { content, changed } = upsertStanza('');
  assert.equal(changed, true);
  assert.ok(content.startsWith(STANZA_START));
  assert.equal(countOccurrences(content, STANZA_START), 1);
  assert.equal(countOccurrences(content, STANZA_END), 1);
});

test('append: existing content is preserved, stanza added after a blank line', () => {
  const original = '# My Project\n\nSome instructions.';
  const { content, changed } = upsertStanza(original);
  assert.equal(changed, true);
  assert.ok(content.startsWith('# My Project'));
  assert.ok(content.includes('Some instructions.'));
  assert.equal(countOccurrences(content, STANZA_START), 1);
});

test('idempotent: re-running on already-stamped content makes no change', () => {
  const once = upsertStanza('# Project\n\nstuff').content;
  const twice = upsertStanza(once);
  assert.equal(twice.changed, false, 'identical stanza is a no-op');
  assert.equal(twice.content, once);
  assert.equal(countOccurrences(twice.content, STANZA_START), 1, 'never a second block');
});

test('update-in-place: a changed body replaces the old block, no duplicate', () => {
  const original = upsertStanza('# Project').content;
  const updated = upsertStanza(original, 'NEW BODY');
  assert.equal(updated.changed, true);
  assert.ok(updated.content.includes('NEW BODY'));
  assert.equal(countOccurrences(updated.content, STANZA_START), 1);
  assert.equal(countOccurrences(updated.content, STANZA_END), 1);
});

test('update preserves surrounding content on both sides of the block', () => {
  const before = '# Top\n\n';
  const after = '\n\n## Bottom section\n\nmore text';
  const seeded = before + renderStanza('OLD') + after;
  const result = upsertStanza(seeded, 'REPLACED');
  assert.ok(result.content.startsWith('# Top'));
  assert.ok(result.content.includes('## Bottom section'));
  assert.ok(result.content.includes('REPLACED'));
  assert.ok(!result.content.includes('OLD'));
});

test('self-heal: a start marker with no end marker does not nest a second block', () => {
  const malformed = '# Project\n\n' + STANZA_START + '\nhalf a block, no end';
  const { content } = upsertStanza(malformed);
  assert.equal(countOccurrences(content, STANZA_START), 1);
  assert.equal(countOccurrences(content, STANZA_END), 1);
});

test('hasStanza: detects presence/absence', () => {
  assert.equal(hasStanza('nothing here'), false);
  assert.equal(hasStanza(upsertStanza('').content), true);
});
