import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  extractLastTurn,
  hasGitCommit,
  hasExplicitSkip,
  hasCaptureFooter,
  lastCaptureTimestamp,
  shouldBlockForCapture
} from '../scripts/lib/capture-gate.js';

function writeTranscript(lines: unknown[]): string {
  const file = path.join(
    os.tmpdir(),
    `capture-gate-test-${Math.random().toString(36).slice(2)}.jsonl`
  );
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

const bashCommit = { type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "fix: x"' } };
const bashLs = { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } };
const editBlock = { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/a.ts' } };

describe('extractLastTurn', () => {
  it('collects tool_use + text after the last user message, with its timestamp', () => {
    const file = writeTranscript([
      {
        type: 'user',
        timestamp: '2026-09-11T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'do the thing' }] }
      },
      { type: 'assistant', message: { content: [bashCommit] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }
    ]);
    const { toolUses, responseText, turnStartTs } = extractLastTurn(file);
    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0].name, 'Bash');
    assert.equal(responseText, 'Done.');
    assert.equal(turnStartTs, '2026-09-11T10:00:00.000Z');
  });

  it('returns empty result for a missing transcript file', () => {
    const result = extractLastTurn('/nonexistent/transcript.jsonl');
    assert.deepEqual(result, { toolUses: [], responseText: '', turnStartTs: null });
  });

  it('ignores earlier turns before the last user message', () => {
    const file = writeTranscript([
      { type: 'assistant', message: { content: [bashCommit] } }, // stale turn, before boundary
      { type: 'user', timestamp: '2026-09-11T10:05:00.000Z', message: { content: [] } },
      { type: 'assistant', message: { content: [editBlock] } }
    ]);
    const { toolUses } = extractLastTurn(file);
    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0].name, 'Edit');
  });
});

describe('hasGitCommit', () => {
  it('detects a git commit Bash call', () => {
    assert.equal(hasGitCommit([bashCommit]), true);
  });

  it('is false for unrelated Bash calls and non-Bash tools', () => {
    assert.equal(hasGitCommit([bashLs, editBlock]), false);
  });

  it('is false for an empty tool list', () => {
    assert.equal(hasGitCommit([]), false);
  });
});

describe('hasExplicitSkip / hasCaptureFooter', () => {
  it('recognizes an explicit capture-skip acknowledgment', () => {
    assert.equal(hasExplicitSkip('All done.\n\nContext: capture-skip: nothing durable here'), true);
    assert.equal(hasExplicitSkip('All done, no footer.'), false);
  });

  it('recognizes captured/propose footers', () => {
    assert.equal(hasCaptureFooter('Context: captured: gotchas/gotcha-foo.md'), true);
    assert.equal(hasCaptureFooter('Context: propose: some-topic'), true);
    assert.equal(hasCaptureFooter('Context: used: foo.md (0.8)'), false);
  });
});

describe('lastCaptureTimestamp', () => {
  it('parses the last line of a captures.log file', () => {
    const file = path.join(os.tmpdir(), `captures-${Math.random().toString(36).slice(2)}.log`);
    fs.writeFileSync(
      file,
      '2026-09-11T09:00:00.000Z | project | gotchas/a.md | "first"\n' +
        '2026-09-11T10:30:00.000Z | project | gotchas/b.md | "second"\n'
    );
    assert.equal(lastCaptureTimestamp(file), '2026-09-11T10:30:00.000Z');
  });

  it('returns null for a missing log file', () => {
    assert.equal(lastCaptureTimestamp('/nonexistent/captures.log'), null);
  });

  it('returns null for an empty log file', () => {
    const file = path.join(
      os.tmpdir(),
      `captures-empty-${Math.random().toString(36).slice(2)}.log`
    );
    fs.writeFileSync(file, '');
    assert.equal(lastCaptureTimestamp(file), null);
  });
});

describe('shouldBlockForCapture', () => {
  it('blocks: commit made, no skip, no footer, no recent capture log entry', () => {
    assert.equal(
      shouldBlockForCapture({
        toolUses: [bashCommit],
        responseText: 'Fixed the bug.',
        turnStartTs: '2026-09-11T10:00:00.000Z',
        lastCaptureTs: '2026-09-11T09:00:00.000Z' // stale, before this turn
      }),
      true
    );
  });

  it('does not block when no commit ran', () => {
    assert.equal(
      shouldBlockForCapture({
        toolUses: [bashLs],
        responseText: 'Looked around.',
        turnStartTs: '2026-09-11T10:00:00.000Z',
        lastCaptureTs: null
      }),
      false
    );
  });

  it('does not block when the response has an explicit capture-skip', () => {
    assert.equal(
      shouldBlockForCapture({
        toolUses: [bashCommit],
        responseText: 'Fixed a typo.\n\nContext: capture-skip: too trivial to capture',
        turnStartTs: '2026-09-11T10:00:00.000Z',
        lastCaptureTs: null
      }),
      false
    );
  });

  it('does not block when the response already has a captured/propose footer', () => {
    assert.equal(
      shouldBlockForCapture({
        toolUses: [bashCommit],
        responseText: 'Fixed it.\n\nContext: captured: gotchas/gotcha-foo.md',
        turnStartTs: '2026-09-11T10:00:00.000Z',
        lastCaptureTs: null
      }),
      false
    );
  });

  it('does not block when a capture was logged after this turn started', () => {
    assert.equal(
      shouldBlockForCapture({
        toolUses: [bashCommit],
        responseText: 'Fixed it, captured via curl earlier in the turn.',
        turnStartTs: '2026-09-11T10:00:00.000Z',
        lastCaptureTs: '2026-09-11T10:05:00.000Z' // after turn start
      }),
      false
    );
  });
});
