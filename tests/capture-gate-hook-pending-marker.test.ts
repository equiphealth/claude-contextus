/**
 * capture-gate-hook.js: the block → stop_hook_active retry round trip.
 *
 * Runs the real hook FILE twice (block, then retry), the way Claude Code
 * actually invokes it, with an isolated HOME so writes to captures.log and
 * the pending marker never touch the real ~/.contextus/. Covers the bug this
 * fixes: extractCommitSummary(toolUses) can't be re-derived from the
 * transcript on the retry invocation (the injected block reason reshapes the
 * detected turn boundary), so the hook now persists the commit summary to a
 * one-shot, per-project marker file written on block and consumed on retry.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.resolve(__dirname, '..', 'scripts', 'capture-gate-hook.js');

function projectHash(cwd: string): string {
  return crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 12);
}

function writeTranscript(homeDir: string, lines: unknown[]): string {
  const file = path.join(homeDir, 'transcript.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

function runHook(payload: unknown, homeDir: string) {
  const res = spawnSync('node', [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, HOME: homeDir }
  });
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = res.stdout.trim() ? JSON.parse(res.stdout.trim()) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, parsed };
}

function setup() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-gate-home-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-gate-project-'));
  fs.mkdirSync(path.join(projectDir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'contextus.jsonc'),
    JSON.stringify({ contextCapture: { stopGate: true } })
  );
  return { homeDir, projectDir };
}

test('capture-gate-hook.js: blocks on an uncaptured commit, then on retry logs "missed" using the saved commit summary', () => {
  const { homeDir, projectDir } = setup();
  const transcript = writeTranscript(homeDir, [
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'fix the bug and commit' }] }
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: real bug"' } }
        ]
      }
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);

  const first = runHook({ transcript_path: transcript, cwd: projectDir }, homeDir);
  assert.equal(first.status, 0, `stderr: ${first.stderr}`);
  assert.equal(first.parsed?.decision, 'block');

  const markerPath = path.join(
    homeDir,
    '.contextus',
    `.capture-gate-pending-${projectHash(projectDir)}.json`
  );
  assert.ok(fs.existsSync(markerPath), 'pending marker should be written when blocking');
  assert.equal(JSON.parse(fs.readFileSync(markerPath, 'utf8')).commitSummary, 'fix: real bug');

  // Retry: still no capture, and the transcript now ALSO carries the hook's
  // own injected block-reason turn — exactly the shape that broke
  // extractCommitSummary(toolUses) before this fix.
  const retryTranscript = writeTranscript(homeDir, [
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'fix the bug and commit' }] }
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: real bug"' } }
        ]
      }
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.' }] } },
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:01.000Z',
      message: { content: [{ type: 'text', text: 'You ran `git commit`... call /capture now.' }] }
    }
  ]);
  const retry = runHook(
    { transcript_path: retryTranscript, cwd: projectDir, stop_hook_active: true },
    homeDir
  );
  assert.equal(retry.status, 0, `stderr: ${retry.stderr}`);
  assert.equal(retry.stdout.trim(), '', 'retry must never block again (loop guard)');
  assert.ok(
    !fs.existsSync(markerPath),
    'pending marker must be consumed (one-shot) after the retry'
  );

  const nudges = fs
    .readFileSync(path.join(homeDir, '.contextus', 'logs', 'capture-nudges.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(nudges.length, 2);
  assert.equal(nudges[0].outcome, 'nudged');
  assert.equal(nudges[0].commitSummary, 'fix: real bug');
  assert.equal(nudges[1].outcome, 'missed');
  assert.equal(nudges[1].commitSummary, 'fix: real bug');

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('capture-gate-hook.js: retry where the nudge worked (captured footer) logs "captured_after_nudge"', () => {
  const { homeDir, projectDir } = setup();
  const transcript = writeTranscript(homeDir, [
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'fix the bug and commit' }] }
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: real bug"' } }
        ]
      }
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.' }] } }
  ]);
  const first = runHook({ transcript_path: transcript, cwd: projectDir }, homeDir);
  assert.equal(first.parsed?.decision, 'block');

  // Nudge worked: Claude's retry-turn response includes a captured footer —
  // same boundary-shift transcript shape as the "missed" test, but this time
  // the trailing assistant text is the resolution proof.
  const retryTranscript = writeTranscript(homeDir, [
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'fix the bug and commit' }] }
    },
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: real bug"' } }
        ]
      }
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Fixed it.' }] } },
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:01.000Z',
      message: { content: [{ type: 'text', text: 'You ran `git commit`... call /capture now.' }] }
    },
    {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'Done.\n\nContext: captured: gotchas/gotcha-x.md' }]
      }
    }
  ]);
  const retry = runHook(
    { transcript_path: retryTranscript, cwd: projectDir, stop_hook_active: true },
    homeDir
  );
  assert.equal(retry.status, 0, `stderr: ${retry.stderr}`);
  assert.equal(retry.stdout.trim(), '');

  const nudges = fs
    .readFileSync(path.join(homeDir, '.contextus', 'logs', 'capture-nudges.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(nudges[1].outcome, 'captured_after_nudge');

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('capture-gate-hook.js: retry with no pending marker (gate never actually blocked) is a silent no-op', () => {
  const { homeDir, projectDir } = setup();
  const transcript = writeTranscript(homeDir, [
    {
      type: 'user',
      timestamp: '2026-09-11T10:00:00.000Z',
      message: { content: [{ type: 'text', text: 'just look around' }] }
    },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Done looking.' }] } }
  ]);
  const retry = runHook(
    { transcript_path: transcript, cwd: projectDir, stop_hook_active: true },
    homeDir
  );
  assert.equal(retry.status, 0, `stderr: ${retry.stderr}`);
  assert.equal(retry.stdout.trim(), '');
  assert.ok(
    !fs.existsSync(path.join(homeDir, '.contextus', 'logs', 'capture-nudges.jsonl')),
    'nothing to report — must not fabricate a nudge log entry'
  );

  fs.rmSync(homeDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});
