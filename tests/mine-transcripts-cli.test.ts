/**
 * mine-transcripts CLI arg parsing — regression guard for GH issue #39: a
 * prior version hardcoded maxSessions=3 regardless of backlog size, silently
 * dropping most pending sessions on every catch-up run. No cap by default now.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../scripts/mine-transcripts.js';

test('parseArgs: no --max-sessions flag → maxSessions is undefined (uncapped)', () => {
  const args = parseArgs([]);
  assert.equal(args.maxSessions, undefined);
});

test('parseArgs: --max-sessions 5 → maxSessions is 5', () => {
  const args = parseArgs(['--max-sessions', '5']);
  assert.equal(args.maxSessions, 5);
});

test('parseArgs: --max-sessions with a garbage value → falls back to uncapped, not a magic default', () => {
  const args = parseArgs(['--max-sessions', 'not-a-number']);
  assert.equal(args.maxSessions, undefined);
});

test('parseArgs: --max-sessions 0 or negative → treated as invalid, uncapped', () => {
  assert.equal(parseArgs(['--max-sessions', '0']).maxSessions, undefined);
  assert.equal(parseArgs(['--max-sessions', '-1']).maxSessions, undefined);
});

test('parseArgs: --dry-run, --all, --list, --help flags parse correctly', () => {
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
  assert.equal(parseArgs(['--all']).all, true);
  assert.equal(parseArgs(['--list']).list, true);
  assert.equal(parseArgs(['--help']).help, true);
  assert.equal(parseArgs(['-h']).help, true);
});

test('parseArgs: --project and --since capture their values', () => {
  const args = parseArgs(['--project', '/some/path', '--since', '7d']);
  assert.equal(args.project, '/some/path');
  assert.equal(args.since, '7d');
});

test('parseArgs: defaults with no flags at all', () => {
  const args = parseArgs([]);
  assert.equal(args.all, false);
  assert.equal(args.dryRun, false);
  assert.equal(args.list, false);
  assert.equal(args.help, false);
  assert.equal(args.project, undefined);
  assert.equal(args.since, undefined);
});
