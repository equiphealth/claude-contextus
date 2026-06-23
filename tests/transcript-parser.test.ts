/**
 * Transcript parser unit tests — slug derivation, turn parsing,
 * interesting-turn filtering, window chunking with overlap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  projectSlug,
  parseSession,
  filterInterestingTurns,
  windowTurns,
  type Turn
} from '../lib/transcript/parser.js';

// --- projectSlug ---

test('projectSlug: replaces slashes and dots with dashes', () => {
  assert.equal(
    projectSlug('/Users/Anthony.Dawson/src/claude-contextus'),
    '-Users-Anthony-Dawson-src-claude-contextus'
  );
});

test('projectSlug: handles paths without dots', () => {
  assert.equal(projectSlug('/home/user/project'), '-home-user-project');
});

test('projectSlug: handles root path', () => {
  assert.equal(projectSlug('/'), '-');
});

// --- parseSession ---

test('parseSession: parses user+assistant turn pairs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  const sessionFile = path.join(tmpDir, 'test-session.jsonl');

  const lines = [
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'How do I configure X?' },
      timestamp: '2026-06-20T10:00:00Z',
      sessionId: 'abc123'
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'You configure X by editing config.json.' }]
      },
      timestamp: '2026-06-20T10:00:01Z'
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'What about Y?' },
      timestamp: '2026-06-20T10:01:00Z',
      sessionId: 'abc123'
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Y is related to Z...' },
          { type: 'text', text: 'Y depends on Z being configured first.' }
        ]
      },
      timestamp: '2026-06-20T10:01:01Z'
    })
  ];
  fs.writeFileSync(sessionFile, lines.join('\n'));

  const turns = await parseSession(sessionFile);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].userContent, 'How do I configure X?');
  assert.equal(turns[0].assistantText, 'You configure X by editing config.json.');
  assert.equal(turns[0].assistantThinking, '');
  assert.equal(turns[1].assistantThinking, 'Y is related to Z...');
  assert.equal(turns[1].assistantText, 'Y depends on Z being configured first.');
  assert.equal(turns[1].sessionId, 'abc123');

  fs.rmSync(tmpDir, { recursive: true });
});

test('parseSession: handles tool_use blocks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  const sessionFile = path.join(tmpDir, 'tools.jsonl');

  const lines = [
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Read the file' },
      timestamp: '2026-06-20T10:00:00Z',
      sessionId: 's1'
    }),
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/foo.ts' } },
          { type: 'text', text: 'Here is the content.' }
        ]
      }
    })
  ];
  fs.writeFileSync(sessionFile, lines.join('\n'));

  const turns = await parseSession(sessionFile);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].toolCalls.length, 1);
  assert.equal(turns[0].toolCalls[0].name, 'Read');
  assert.match(turns[0].toolCalls[0].input, /foo\.ts/);

  fs.rmSync(tmpDir, { recursive: true });
});

test('parseSession: skips malformed JSON lines', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  const sessionFile = path.join(tmpDir, 'bad.jsonl');

  const lines = [
    'not valid json {{{',
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello' },
      timestamp: '2026-06-20T10:00:00Z',
      sessionId: 's1'
    }),
    '{ broken',
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] }
    })
  ];
  fs.writeFileSync(sessionFile, lines.join('\n'));

  const turns = await parseSession(sessionFile);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistantText, 'Hi!');

  fs.rmSync(tmpDir, { recursive: true });
});

test('parseSession: handles string content (non-array)', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-test-'));
  const sessionFile = path.join(tmpDir, 'string.jsonl');

  const lines = [
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'test' },
      timestamp: '2026-06-20T10:00:00Z',
      sessionId: 's1'
    }),
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: 'plain string response' }
    })
  ];
  fs.writeFileSync(sessionFile, lines.join('\n'));

  const turns = await parseSession(sessionFile);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].assistantText, 'plain string response');

  fs.rmSync(tmpDir, { recursive: true });
});

// --- filterInterestingTurns ---

function makeTurn(opts: Partial<Turn> = {}): Turn {
  return {
    timestamp: '2026-06-20T10:00:00Z',
    userContent: opts.userContent ?? 'a'.repeat(100),
    assistantText: opts.assistantText ?? 'b'.repeat(150),
    assistantThinking: opts.assistantThinking ?? '',
    toolCalls: opts.toolCalls ?? [],
    sessionId: 'test',
    sessionFile: 'test.jsonl'
  };
}

test('filterInterestingTurns: keeps turns with sufficient text', () => {
  const turns = [makeTurn({ userContent: 'a'.repeat(100), assistantText: 'b'.repeat(200) })];
  const result = filterInterestingTurns(turns);
  assert.equal(result.length, 1);
});

test('filterInterestingTurns: removes trivial turns (<200 chars total)', () => {
  const turns = [makeTurn({ userContent: 'hi', assistantText: 'hello', assistantThinking: '' })];
  const result = filterInterestingTurns(turns);
  assert.equal(result.length, 0);
});

test('filterInterestingTurns: removes tool-only turns (no text or thinking)', () => {
  const turns = [
    makeTurn({
      userContent: 'a'.repeat(300),
      assistantText: '',
      assistantThinking: '',
      toolCalls: [{ name: 'Read', input: '/foo' }]
    })
  ];
  const result = filterInterestingTurns(turns);
  assert.equal(result.length, 0);
});

test('filterInterestingTurns: keeps turns with only thinking (no text)', () => {
  const turns = [
    makeTurn({
      userContent: 'a'.repeat(100),
      assistantText: '',
      assistantThinking: 'b'.repeat(200)
    })
  ];
  const result = filterInterestingTurns(turns);
  assert.equal(result.length, 1);
});

// --- windowTurns ---

test('windowTurns: single turn stays in one window', () => {
  const turns = [makeTurn()];
  const windows = windowTurns(turns, 4000);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].turns.length, 1);
});

test('windowTurns: splits when exceeding token budget', () => {
  const bigTurn = makeTurn({ userContent: 'x'.repeat(8000), assistantText: 'y'.repeat(8000) });
  const turns = [bigTurn, bigTurn, bigTurn];
  const windows = windowTurns(turns, 4000);
  assert.ok(windows.length >= 3, `Expected >=3 windows, got ${windows.length}`);
});

test('windowTurns: overlap includes last turn of previous window', () => {
  const t1 = makeTurn({ userContent: 'first'.repeat(500), assistantText: 'a'.repeat(500) });
  const t2 = makeTurn({ userContent: 'second'.repeat(500), assistantText: 'b'.repeat(500) });
  const t3 = makeTurn({ userContent: 'third'.repeat(500), assistantText: 'c'.repeat(500) });
  const windows = windowTurns([t1, t2, t3], 1000);

  // With 1000 token budget (~4000 chars), each turn is ~2000 chars (~500 tokens)
  // So windows should split, with overlap
  if (windows.length > 1) {
    const lastOfFirst = windows[0].turns[windows[0].turns.length - 1];
    const firstOfSecond = windows[1].turns[0];
    assert.equal(lastOfFirst.userContent, firstOfSecond.userContent);
  }
});

test('windowTurns: empty input returns no windows', () => {
  const windows = windowTurns([], 4000);
  assert.equal(windows.length, 0);
});
