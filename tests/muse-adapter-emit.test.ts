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
  // The block must fit the WIRE cap (payload + JSON envelope + newline), not
  // just the payload cap — otherwise this exercises the defect line-cut path.
  const envelope = Buffer.byteLength(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: '' }
    }) + '\n',
    'utf8'
  );
  const daemonBlock = 'D'.repeat(STDOUT_CEILING - envelope - 10);
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

test('cutAtLine: result fits cap INCLUDING the marker', () => {
  const { text, cut } = cutAtLine('keep-this\n' + 'x'.repeat(5000), 100);
  assert.equal(cut, true);
  assert.ok(
    Buffer.byteLength(text, 'utf8') <= 100,
    `marker-inclusive size must fit cap, got ${Buffer.byteLength(text, 'utf8')}`
  );
  assert.ok(text.endsWith('[contextus: truncated at host ceiling]'));
});

test('emitMerged: full wire output fits the host ceiling, envelope included', () => {
  const big = 'line-one\n' + 'Z'.repeat(STDOUT_CEILING * 2);
  const { out } = capture(() =>
    emitMerged({
      hookEventName: 'UserPromptSubmit',
      daemonBlock: big,
      footer: 'FOOT'.repeat(500),
      systemMessage: 'sys note '.repeat(50)
    })
  );
  const wire = out.endsWith('\n') ? out : out + '\n';
  assert.ok(
    Buffer.byteLength(wire, 'utf8') <= STDOUT_CEILING,
    `wire size must fit host ceiling, got ${Buffer.byteLength(wire, 'utf8')}`
  );
  const parsed = JSON.parse(out);
  assert.ok(
    parsed.hookSpecificOutput.additionalContext.includes('[contextus: truncated at host ceiling]')
  );
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
