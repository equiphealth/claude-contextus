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
  shouldBlockForCapture,
  extractCommitSummary,
  logCaptureNudge
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

  it('does not mistake a tool_result (also type: "user") for the turn boundary', () => {
    // Real Claude Code transcript shape: every tool_use is immediately
    // followed by its own tool_result, which is ALSO a `type: 'user'` entry
    // (same as the Messages API). A commit that isn't the very last tool
    // call of the turn must still be found, not hidden behind its own result.
    const file = writeTranscript([
      {
        type: 'user',
        timestamp: '2026-09-11T10:00:00.000Z',
        message: { content: [{ type: 'text', text: 'fix the bug and commit' }] }
      },
      { type: 'assistant', message: { content: [bashCommit] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { content: [bashLs] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'file list' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } }
    ]);
    const { toolUses, responseText, turnStartTs } = extractLastTurn(file);
    assert.equal(toolUses.length, 2);
    assert.equal(toolUses[0].name, 'Bash');
    assert.equal((toolUses[0].input as { command: string }).command, bashCommit.input.command);
    assert.equal(responseText, 'Done.');
    assert.equal(turnStartTs, '2026-09-11T10:00:00.000Z');
  });

  it('still stops at a genuine prior user message even past several tool_results', () => {
    const file = writeTranscript([
      { type: 'assistant', message: { content: [bashCommit] } }, // stale turn, before boundary
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'stale result' }] } },
      { type: 'user', timestamp: '2026-09-11T10:05:00.000Z', message: { content: [] } },
      { type: 'assistant', message: { content: [editBlock] } },
      { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Edited.' }] } }
    ]);
    const { toolUses, turnStartTs } = extractLastTurn(file);
    assert.equal(toolUses.length, 1);
    assert.equal(toolUses[0].name, 'Edit');
    assert.equal(turnStartTs, '2026-09-11T10:05:00.000Z');
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
    assert.equal(hasCaptureFooter('Context: captured [project]: gotchas/gotcha-foo.md'), true);
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

describe('extractCommitSummary', () => {
  it('extracts a double-quoted -m message', () => {
    const summary = extractCommitSummary([
      { name: 'Bash', input: { command: 'git commit -m "fix: normalize dedup key"' } }
    ]);
    assert.equal(summary, 'fix: normalize dedup key');
  });

  it('extracts a single-quoted -m message', () => {
    const summary = extractCommitSummary([
      { name: 'Bash', input: { command: "git commit -m 'chore: bump deps'" } }
    ]);
    assert.equal(summary, 'chore: bump deps');
  });

  it('extracts the first line of a heredoc commit message', () => {
    const summary = extractCommitSummary([
      {
        name: 'Bash',
        input: {
          command:
            'git commit -m "$(cat <<\'EOF\'\nfeat: prototype Stop-hook gate\n\nlonger body here\nEOF\n)"'
        }
      }
    ]);
    assert.equal(summary, 'feat: prototype Stop-hook gate');
  });

  it('falls back to a generic label when the message cannot be parsed', () => {
    const summary = extractCommitSummary([{ name: 'Bash', input: { command: 'git commit' } }]);
    assert.equal(summary, 'recent commit');
  });

  it('returns null when there is no commit call at all', () => {
    assert.equal(extractCommitSummary([bashLs]), null);
  });
});

describe('logCaptureNudge', () => {
  function tmpLogDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'capture-nudge-log-'));
  }

  it('appends a JSONL record and a human-readable daemon.log line for a nudge', () => {
    const logDir = tmpLogDir();
    logCaptureNudge({ outcome: 'nudged', project: 'abc123', commitSummary: 'fix: x', logDir });

    const jsonl = fs.readFileSync(path.join(logDir, 'capture-nudges.jsonl'), 'utf-8').trim();
    const record = JSON.parse(jsonl);
    assert.equal(record.type, 'capture_nudge');
    assert.equal(record.outcome, 'nudged');
    assert.equal(record.project, 'abc123');
    assert.equal(record.commitSummary, 'fix: x');
    assert.ok(record.timestamp);

    const humanLog = fs.readFileSync(path.join(logDir, 'daemon.log'), 'utf-8');
    assert.match(humanLog, /Nudged Claude to capture context for "fix: x" — waiting for response/);
  });

  it('logs the "but it did not" message on a missed outcome', () => {
    const logDir = tmpLogDir();
    logCaptureNudge({ outcome: 'missed', project: 'abc123', commitSummary: 'fix: y', logDir });
    const humanLog = fs.readFileSync(path.join(logDir, 'daemon.log'), 'utf-8');
    assert.match(humanLog, /Nudged Claude to capture context for "fix: y" but it did not/);
    assert.match(humanLog, /WARN/);
  });

  it('logs the recovered message on a captured-after-nudge outcome', () => {
    const logDir = tmpLogDir();
    logCaptureNudge({
      outcome: 'captured_after_nudge',
      project: 'abc123',
      commitSummary: 'fix: z',
      logDir
    });
    const humanLog = fs.readFileSync(path.join(logDir, 'daemon.log'), 'utf-8');
    assert.match(humanLog, /Claude captured context for "fix: z" after being nudged/);
  });

  it('never throws when the log directory cannot be created', () => {
    // A file path used as a "directory" — mkdirSync will fail; must be silently best-effort.
    const fakeDir = path.join(
      os.tmpdir(),
      `capture-nudge-not-a-dir-${Math.random().toString(36).slice(2)}`
    );
    fs.writeFileSync(fakeDir, 'not a directory');
    assert.doesNotThrow(() =>
      logCaptureNudge({
        outcome: 'nudged',
        project: 'abc123',
        commitSummary: 'fix: x',
        logDir: fakeDir
      })
    );
  });
});
