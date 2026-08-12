/**
 * checkTranscriptMining — the SessionStart gating logic for the recurring
 * transcript-mining trigger (GH issue #39). Off by default — requires an
 * explicit `{enabled: true}` config (from the project's properly MERGED
 * config, piggybacked onto /reconcile's check-mode response) before it ever
 * looks at the watermark. Pure decision logic otherwise: reads the watermark
 * file + lists a directory, no LLM/daemon calls, no process spawning.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Route HOME to a throwaway dir BEFORE importing daemon-control.js — it
// resolves ~/.contextus/transcript-state.json and ~/.claude/projects/ off
// HOME at call time (not import time), but isolating early avoids any
// chance of touching the real ~/.contextus/.
const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));
process.env.HOME = homeDir;

const { checkTranscriptMining } = await import('../scripts/lib/daemon-control.js');

const PROJECTS_DIR = path.join(homeDir, '.claude', 'projects');
const STATE_PATH = path.join(homeDir, '.contextus', 'transcript-state.json');
const ENABLED = { enabled: true, intervalHours: 24 };

function projectDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
}

function slugFor(cwd: string): string {
  return path.resolve(cwd).replace(/[/.]/g, '-');
}

function seedSessionFiles(cwd: string, mtimes: Date[]): void {
  const dir = path.join(PROJECTS_DIR, slugFor(cwd));
  fs.mkdirSync(dir, { recursive: true });
  mtimes.forEach((mtime, i) => {
    const file = path.join(dir, `session-${i}.jsonl`);
    fs.writeFileSync(file, '{}\n');
    fs.utimesSync(file, mtime, mtime);
  });
}

function writeWatermark(cwd: string, lastScanned: string): void {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const state = { version: 1, projects: { [slugFor(cwd)]: { lastScanned } } };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state));
}

test('no config at all (daemon unreachable) → never due, regardless of session files', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date(), new Date()]);
  const result = checkTranscriptMining(cwd, undefined);
  assert.equal(result.due, false);
  assert.equal(result.pending, 0);
});

test('config present but enabled:false (the default) → never due', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  const result = checkTranscriptMining(cwd, { enabled: false, intervalHours: 24 });
  assert.equal(result.due, false);
  assert.equal(result.pending, 0);
});

test('enabled + never scanned + no session files → not due (nothing to mine)', () => {
  const cwd = projectDir();
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, false);
  assert.equal(result.pending, 0);
});

test('enabled + never scanned + session files present → due, with a pending count', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date(), new Date()]);
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, true);
  assert.equal(result.pending, 2);
});

test('enabled + scanned within the interval → not due, regardless of session files present', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  writeWatermark(cwd, new Date(Date.now() - 60_000).toISOString()); // 1 minute ago
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, false);
  assert.equal(result.pending, 0);
});

test('enabled + scanned past the interval, no new sessions since → due=false (nothing new)', () => {
  const cwd = projectDir();
  const scanTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
  seedSessionFiles(cwd, [new Date(scanTime.getTime() - 60_000)]); // BEFORE the scan
  writeWatermark(cwd, scanTime.toISOString());
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, false);
  assert.equal(result.pending, 0);
});

test('enabled + scanned past the interval, new sessions since → due=true, counts only new ones', () => {
  const cwd = projectDir();
  const scanTime = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25h ago
  seedSessionFiles(cwd, [
    new Date(scanTime.getTime() - 60_000), // before watermark — not counted
    new Date(scanTime.getTime() + 60_000), // after watermark — counted
    new Date() // after watermark — counted
  ]);
  writeWatermark(cwd, scanTime.toISOString());
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, true);
  assert.equal(result.pending, 2);
});

test('custom intervalHours is honored, not just the 24h default', () => {
  const cwd = projectDir();
  const scanTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago
  seedSessionFiles(cwd, [new Date()]);
  writeWatermark(cwd, scanTime.toISOString());
  // 1h interval: 2h-old scan is already past due.
  assert.equal(checkTranscriptMining(cwd, { enabled: true, intervalHours: 1 }).due, true);
  // 6h interval: 2h-old scan is still within it.
  assert.equal(checkTranscriptMining(cwd, { enabled: true, intervalHours: 6 }).due, false);
});

test('malformed intervalHours (non-numeric) falls back to the safe 24h default, not "always due"', () => {
  // Regression (independent review of #40): `?? 24` only catches
  // null/undefined, not a typo'd string like "daily" in a hand-edited
  // .claude/contextus.jsonc. `"daily" * 3600000` is NaN, and `elapsed < NaN`
  // is always false — that used to silently disable the throttle entirely,
  // making mining due on every single SessionStart instead of respecting
  // any interval.
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  writeWatermark(cwd, new Date(Date.now() - 60_000).toISOString()); // 1 minute ago
  const result = checkTranscriptMining(cwd, { enabled: true, intervalHours: 'daily' });
  assert.equal(result.due, false, 'a scan 1 minute ago must still be within the 24h fallback');
});

test('intervalHours: 0 is honored as a deliberate "always due" choice, not treated as invalid', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  writeWatermark(cwd, new Date(Date.now() - 1000).toISOString()); // 1 second ago
  const result = checkTranscriptMining(cwd, { enabled: true, intervalHours: 0 });
  assert.equal(result.due, true);
});

test('malformed intervalHours (negative) falls back to the safe 24h default', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  writeWatermark(cwd, new Date(Date.now() - 60_000).toISOString());
  const result = checkTranscriptMining(cwd, { enabled: true, intervalHours: -5 });
  assert.equal(result.due, false);
});

test('corrupt/unparseable watermark file → treated as never scanned, not a crash', () => {
  const cwd = projectDir();
  seedSessionFiles(cwd, [new Date()]);
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, '{not valid json');
  const result = checkTranscriptMining(cwd, ENABLED);
  assert.equal(result.due, true);
  assert.equal(result.pending, 1);
});
