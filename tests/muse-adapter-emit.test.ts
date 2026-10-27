/**
 * Adapter emission helper — unit tests (Muse support, Phase 1).
 *
 * `emitMerged` appends the adapter footer to the daemon block without ever
 * re-cutting daemon output: over the ceiling it drops only its own footer
 * first, and only a seam-bypassing oversized daemon block hits the
 * line-boundary backstop (marked, never a blind cut). Plain JS, no daemon.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emitMerged, cutAtLine, STDOUT_CEILING } from '../adapter/shared/emit.js';

function capture(fn) {
  const writes = [];
  const orig = process.stdout.write;
  const errors = [];
  const origErr = console.error;
  process.stdout.write = (s) => {
    writes.push(String(s));
    return true;
  };
  console.error = (...a) => {
    errors.push(a.join(' '));
  };
  try {
    fn();
  } finally {
    process.stdout.write = orig;
    console.error = origErr;
  }
  return { out: writes.join(''), errors };
}

test('emitMerged: under ceiling passes block + footer through', () => {
  const { out } = capture(() =>
    emitMerged({ hookEventName: 'UserPromptSubmit', daemonBlock: 'CTX', footer: 'FOOT' })
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(parsed.hookSpecificOutput.additionalContext, 'CTX\n\nFOOT');
});

test('emitMerged: over ceiling drops only the adapter footer', () => {
  const daemonBlock = 'D'.repeat(STDOUT_CEILING - 10);
  const { out, errors } = capture(() =>
    emitMerged({ hookEventName: 'UserPromptSubmit', daemonBlock, footer: 'FOOT'.repeat(100) })
  );
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.additionalContext, daemonBlock, 'daemon block intact');
  assert.ok(errors.some((e) => e.includes('dropping adapter footer')));
});

test('emitMerged: oversized daemon block hits the marked line-cut backstop', () => {
  const daemonBlock = 'line-one\n' + 'Z'.repeat(STDOUT_CEILING);
  const { out, errors } = capture(() =>
    emitMerged({ hookEventName: 'UserPromptSubmit', daemonBlock })
  );
  const parsed = JSON.parse(out);
  const ctx = parsed.hookSpecificOutput.additionalContext;
  assert.ok(Buffer.byteLength(ctx, 'utf8') <= STDOUT_CEILING);
  assert.ok(ctx.includes('[contextus: truncated at host ceiling]'), 'cut is marked');
  assert.ok(errors.some((e) => e.includes('DEFECT')));
});

test('cutAtLine: under cap returns text unchanged', () => {
  const { text, cut } = cutAtLine('a\nb', 100);
  assert.equal(text, 'a\nb');
  assert.equal(cut, false);
});

test('cutAtLine: cuts at a newline boundary, never mid-line', () => {
  const { text, cut } = cutAtLine('keep-this\n' + 'x'.repeat(500), 100);
  assert.equal(cut, true);
  assert.ok(text.startsWith('keep-this\n'));
  assert.ok(!text.includes('x'.repeat(500)));
});
