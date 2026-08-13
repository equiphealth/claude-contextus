/**
 * Concurrent-run lock for transcript mining (independent review of PR #40,
 * item #4, GH issue #39). The SessionStart trigger fires-and-forgets, so two
 * Claude Code sessions opened against the same project within the mining
 * window used to both spawn a full scan of the same backlog — doubled LLM
 * cost, duplicate /capture writes. acquireMiningLock/releaseMiningLock live
 * in lib/transcript/state.ts and are enforced solely by mineProject (the
 * spawned CLI), not the SessionStart hook — see the comment there for why.
 *
 * Isolates HOME to a throwaway dir so this never touches the real
 * ~/.contextus/runtime/.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-lock-home-'));
process.env.HOME = homeDir;

const { acquireMiningLock, releaseMiningLock } = await import('../lib/transcript/state.js');
const { mineProject } = await import('../scripts/mine-transcripts.js');

function lockFile(slug: string): string {
  return path.join(homeDir, '.contextus', 'runtime', `transcript-mining-${slug}.lock`);
}

test('acquireMiningLock: first caller acquires, writes its own pid to the lock file', () => {
  const slug = 'proj-a';
  const acquired = acquireMiningLock(slug);
  assert.equal(acquired, true);
  assert.equal(fs.readFileSync(lockFile(slug), 'utf-8'), String(process.pid));
  releaseMiningLock(slug);
});

test('acquireMiningLock: second caller while the first still holds it → false (no overwrite)', () => {
  const slug = 'proj-b';
  assert.equal(acquireMiningLock(slug), true);
  assert.equal(acquireMiningLock(slug), false, 'a live lock must block a second acquire');
  releaseMiningLock(slug);
});

test('releaseMiningLock: removes the lock file, freeing it for the next acquire', () => {
  const slug = 'proj-c';
  assert.equal(acquireMiningLock(slug), true);
  releaseMiningLock(slug);
  assert.equal(fs.existsSync(lockFile(slug)), false);
  assert.equal(acquireMiningLock(slug), true, 'lock must be acquirable again after release');
  releaseMiningLock(slug);
});

test('acquireMiningLock: a stale lock (dead pid) is treated as free, not a permanent block', () => {
  const slug = 'proj-d';
  const p = lockFile(slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // PID 999999 is essentially guaranteed not to be a live process.
  fs.writeFileSync(p, '999999');
  assert.equal(
    acquireMiningLock(slug),
    true,
    'a lock held by a dead pid must not block acquisition forever'
  );
  releaseMiningLock(slug);
});

test('releaseMiningLock: does not remove a lock file owned by a different pid', () => {
  const slug = 'proj-e';
  const p = lockFile(slug);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '999999'); // pretend some other (dead) process owns it
  releaseMiningLock(slug); // must be a no-op — this process doesn't own it
  assert.equal(fs.existsSync(p), true, 'release must not remove a lock it does not own');
  fs.rmSync(p);
});

test('mineProject: a project already locked is skipped entirely — no session scan, no network', async () => {
  // projectSlug() (lib/transcript/parser.js) is what mineProject actually
  // hashes the path with — mirror it here so the pre-acquired lock lands on
  // the exact same lock file mineProject will look for.
  const { projectSlug } = await import('../lib/transcript/parser.js');
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-lock-project-'));
  const slug = projectSlug(projectDir);

  assert.equal(acquireMiningLock(slug), true, 'test setup: pre-acquire the lock');
  try {
    // No daemon running, no session files seeded — if mineProject didn't
    // bail out on the lock, it would still return {extracted:0, sessions:0}
    // via its normal "no session files" path, so a passing result alone
    // wouldn't prove the lock was checked. The real proof is the log line;
    // capture console.log to confirm the skip message fired instead of the
    // normal "Project:"/"Since:" scan output.
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      const result = await mineProject(projectDir, {
        all: false,
        dryRun: false,
        list: false,
        help: false
      });
      assert.deepEqual(result, { extracted: 0, sessions: 0 });
      assert.ok(
        lines.some((l) => l.includes('already in progress')),
        'expected the lock-skip message, got: ' + JSON.stringify(lines)
      );
      assert.ok(
        !lines.some((l) => l.includes('📂 Project')),
        'mineProject must bail out before starting a real scan'
      );
    } finally {
      console.log = originalLog;
    }
  } finally {
    releaseMiningLock(slug);
  }
});
