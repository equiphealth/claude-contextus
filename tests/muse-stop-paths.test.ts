/**
 * Muse Stop hook file contract (must-fix work order Fix 1).
 *
 * The review found the Muse Stop looking in different places and under a
 * different key than the daemon / Claude Stop: `daemon.log` at the home
 * root instead of `logs/`, session state under `data/` instead of the
 * dotfile, and the eval queue without its dot prefix — so live Stop found
 * no injection and exited 0 silently. These tests run the real stop.js in
 * a child process against a fake HOME and prove the canonical paths and
 * key, including a decoy record at the OLD path that must be ignored.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectHash } from '../scripts/lib/project-hash.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const STOP_JS = path.join(REPO_ROOT, 'adapter', 'muse-code', 'stop.js');

function runStop(home: string, payload: unknown): string {
  return execFileSync(process.execPath, [STOP_JS], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 15000
  });
}

function lastJsonLine(file: string): Record<string, unknown> {
  const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

test('Stop reads canonical session-state and writes canonical usage log + eval queue', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-stopfix-'));
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-stopproj-'));
  try {
    const id = projectHash(projDir);
    fs.mkdirSync(path.join(home, '.contextus'), { recursive: true });
    // Canonical record — what the daemon now writes (keyed by project hash).
    fs.writeFileSync(
      path.join(home, '.contextus', '.session-state.json'),
      JSON.stringify({
        [id]: {
          promptHash: 'p1',
          patterns: [{ id: 'decisions/real.md' }],
          timestamp: new Date().toISOString()
        }
      })
    );
    // Decoy at the OLD non-canonical path — must be ignored, not merged.
    fs.mkdirSync(path.join(home, '.contextus', 'data'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.contextus', 'data', 'session-state.json'),
      JSON.stringify({
        [id]: {
          promptHash: 'decoy',
          patterns: [{ id: 'decoy.md' }],
          timestamp: new Date().toISOString()
        }
      })
    );

    const stdout = runStop(home, {
      cwd: projDir,
      session_id: 'stopfix-1',
      last_assistant_message: 'Done. Context: used: decisions/real.md (0.81)'
    });
    assert.deepEqual(JSON.parse(stdout), {});

    const usage = lastJsonLine(path.join(home, '.contextus', 'logs', 'usage.jsonl'));
    assert.equal(usage.type, 'usage_signal');
    assert.equal(usage.project, id);
    assert.deepEqual(usage.injected, ['decisions/real.md']);
    assert.deepEqual(usage.used, ['decisions/real.md']);

    const queued = lastJsonLine(path.join(home, '.contextus', '.eval-queue.jsonl'));
    assert.equal(queued.project, id);
    assert.equal(queued.projectId, id);
    assert.equal(queued.promptHash, 'p1');

    const daemonLog = fs.readFileSync(path.join(home, '.contextus', 'logs', 'daemon.log'), 'utf-8');
    assert.match(daemonLog, /Usage signal/);

    // Old paths stay untouched.
    assert.ok(!fs.existsSync(path.join(home, '.contextus', 'daemon.log')));
    assert.ok(!fs.existsSync(path.join(home, '.contextus', 'eval-queue.jsonl')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projDir, { recursive: true, force: true });
  }
});

test('Stop with no assistant message stays silent and writes nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-stopfix-'));
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-stopproj-'));
  try {
    const stdout = runStop(home, { cwd: projDir, session_id: 'stopfix-empty' });
    assert.deepEqual(JSON.parse(stdout), {});
    assert.ok(!fs.existsSync(path.join(home, '.contextus', 'logs', 'usage.jsonl')));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(projDir, { recursive: true, force: true });
  }
});
