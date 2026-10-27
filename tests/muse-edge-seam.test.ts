/**
 * Muse request/response edge seam — unit tests.
 *
 * Covers the host-neutral edge in daemon/server.ts: `truncateUtf8Bytes`
 * (enforces the 16384-byte hook stdout ceiling at the edge) and `shapeHookOutput`
 * (Claude passthrough vs Muse-shaped output). Pure functions, no daemon needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truncateUtf8Bytes, shapeHookOutput, HOST_OUTPUT_CEILING } from '../daemon/server.js';

test('ceiling is one byte inside the 16384 kill line', () => {
  assert.equal(HOST_OUTPUT_CEILING, 16383);
});

test('truncateUtf8Bytes: short ASCII passes through untouched', () => {
  assert.equal(truncateUtf8Bytes('hello', 16383), 'hello');
  assert.equal(truncateUtf8Bytes('', 16383), '');
});

test('truncateUtf8Bytes: exact-cap ASCII passes through', () => {
  const s = 'x'.repeat(16383);
  assert.equal(truncateUtf8Bytes(s, 16383), s);
});

test('truncateUtf8Bytes: ASCII cut lands byte-exact', () => {
  const out = truncateUtf8Bytes('x'.repeat(20000), 16383);
  assert.equal(Buffer.byteLength(out, 'utf8'), 16383);
});

test('truncateUtf8Bytes: never splits a multi-byte sequence', () => {
  // 'é' is 2 bytes in UTF-8; cap lands mid-character without the guard.
  const s = 'a'.repeat(16382) + 'éé';
  const out = truncateUtf8Bytes(s, 16383);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 16383);
  assert.ok(!out.endsWith('�'), 'must not end with a replacement character');
  assert.equal(out, 'a'.repeat(16382));
});

test('truncateUtf8Bytes: 4-byte emoji boundary is safe', () => {
  const s = 'a'.repeat(16380) + '🎉';
  const out = truncateUtf8Bytes(s, 16383);
  assert.ok(Buffer.byteLength(out, 'utf8') <= 16383);
  assert.ok(!out.includes('�'));
});

test("shapeHookOutput: no agent → today's behavior bit-for-bit, no truncation", () => {
  const big = 'x'.repeat(20000);
  assert.deepEqual(shapeHookOutput(big), {
    continue: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: big }
  });
  assert.deepEqual(shapeHookOutput('hi', { agent: '', hookEvent: 'SessionStart' }), {
    continue: true,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'hi' }
  });
});

test('shapeHookOutput: agent → request hookEvent, ceiling enforced', () => {
  const big = 'y'.repeat(20000);
  const out = shapeHookOutput(big, { agent: 'muse', hookEvent: 'UserPromptSubmit' });
  assert.equal(out.continue, true);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(Buffer.byteLength(out.hookSpecificOutput.additionalContext, 'utf8'), 16383);
});

test('shapeHookOutput: agent without hookEvent defaults to UserPromptSubmit', () => {
  const out = shapeHookOutput('hi', { agent: 'muse' });
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(out.hookSpecificOutput.additionalContext, 'hi');
});
