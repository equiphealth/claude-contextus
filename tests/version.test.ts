import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-ver-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmp;

const { compareSemver, readVersionState, writeVersionState } = await import('../lib/version.js');

after(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('compareSemver: equal versions return 0', () => {
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0);
  assert.equal(compareSemver('0.0.0', '0.0.0'), 0);
});

test('compareSemver: major difference', () => {
  assert.equal(compareSemver('1.0.0', '2.0.0'), -1);
  assert.equal(compareSemver('2.0.0', '1.0.0'), 1);
});

test('compareSemver: minor difference', () => {
  assert.equal(compareSemver('0.7.0', '0.8.0'), -1);
  assert.equal(compareSemver('0.8.0', '0.7.0'), 1);
});

test('compareSemver: patch difference', () => {
  assert.equal(compareSemver('1.0.0', '1.0.1'), -1);
  assert.equal(compareSemver('1.0.2', '1.0.1'), 1);
});

test('readVersionState: returns 0.0.0 when no file exists', () => {
  const state = readVersionState();
  assert.equal(state.version, '0.0.0');
  assert.equal(state.migratedAt, '');
});

test('writeVersionState + readVersionState round-trip', () => {
  writeVersionState('0.8.0');
  const state = readVersionState();
  assert.equal(state.version, '0.8.0');
  assert.ok(state.migratedAt.length > 0);
});

test('writeVersionState: overwrites previous version', () => {
  writeVersionState('0.7.0');
  writeVersionState('0.9.0');
  const state = readVersionState();
  assert.equal(state.version, '0.9.0');
});
