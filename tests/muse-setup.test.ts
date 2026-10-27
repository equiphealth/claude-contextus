/**
 * Muse setup unit tests — AGENTS.md stanza selection, setup-stamp
 * round-trip, and the AGENTS.md stanza predicate the SessionStart hook uses.
 *
 * Covers the Phase 1 §3.4 reminder chain affordances: setup writes the stamp
 * and the host-appropriate stanza; the hook reads both. Daemon reachability
 * and the live nudge text are §6 verification items, not unit tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENTS_STANZA_BODY,
  HOST_STANZA,
  STANZA_BODY,
  hasStanza,
  renderStanza,
  upsertStanza
} from '../lib/capture/claude-md-stanza.js';
import {
  STANZA_START,
  hasAgentsStanza,
  readSetupStamp,
  setupStampPath,
  writeSetupStamp
} from '../scripts/lib/daemon-control.js';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'muse-setup-test-'));
}

test('HOST_STANZA maps muse to AGENTS.md and claude to CLAUDE.md', () => {
  assert.equal(HOST_STANZA.muse.file, 'AGENTS.md');
  assert.equal(HOST_STANZA.muse.body, AGENTS_STANZA_BODY);
  assert.equal(HOST_STANZA.claude.file, 'CLAUDE.md');
  assert.equal(HOST_STANZA.claude.body, STANZA_BODY);
});

test('AGENTS body is host-neutral and carries the corpus path', () => {
  assert.ok(!AGENTS_STANZA_BODY.includes('CLAUDE.md'));
  assert.ok(AGENTS_STANZA_BODY.includes('.claude/context'));
  const block = renderStanza(AGENTS_STANZA_BODY);
  assert.ok(block.startsWith(STANZA_START));
  assert.ok(hasStanza(block));
});

test('upsertStanza appends once and updates in place for AGENTS.md content', () => {
  const base = '# My project\n\nSome intro.\n';
  const first = upsertStanza(base, AGENTS_STANZA_BODY);
  assert.equal(first.changed, true);
  assert.ok(first.content.includes('# My project'));
  assert.ok(hasStanza(first.content));

  const second = upsertStanza(first.content, AGENTS_STANZA_BODY);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);

  const markers = first.content.split(STANZA_START).length - 1;
  assert.equal(markers, 1);
});

test('readSetupStamp is null when setup never ran', () => {
  assert.equal(readSetupStamp(mkTmp()), null);
});

test('writeSetupStamp round-trips host and version', () => {
  const dir = mkTmp();
  const stamp = writeSetupStamp(dir, { host: 'muse' });
  assert.ok(stamp);
  assert.equal(stamp.version, 1);
  assert.equal(stamp.host, 'muse');
  assert.ok(typeof stamp.completedAt === 'string');
  assert.equal(setupStampPath(dir), path.join(dir, '.claude', 'setup.json'));

  const back = readSetupStamp(dir);
  assert.deepEqual(back, stamp);
});

test('readSetupStamp rejects garbage and wrong versions', () => {
  const dir = mkTmp();
  const stampFile = setupStampPath(dir);
  fs.mkdirSync(path.dirname(stampFile), { recursive: true });
  fs.writeFileSync(stampFile, 'not json{{{');
  assert.equal(readSetupStamp(dir), null);
  fs.writeFileSync(stampFile, JSON.stringify({ version: 999 }));
  assert.equal(readSetupStamp(dir), null);
});

test('hasAgentsStanza is false when missing, true when stamped', () => {
  const dir = mkTmp();
  assert.equal(hasAgentsStanza(dir), false);

  const agentsFile = path.join(dir, 'AGENTS.md');
  fs.writeFileSync(agentsFile, '# Rules\n');
  assert.equal(hasAgentsStanza(dir), false);

  const { content } = upsertStanza(fs.readFileSync(agentsFile, 'utf8'), AGENTS_STANZA_BODY);
  fs.writeFileSync(agentsFile, content);
  assert.equal(hasAgentsStanza(dir), true);
});
