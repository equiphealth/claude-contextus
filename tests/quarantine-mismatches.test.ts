/**
 * Unit tests for quarantineMismatches() — the shared guard every embed/reconcile
 * code path now calls (daemon/server.ts's two loops, lib/embedding/reconcile-run.ts,
 * lib/embedding/embed-file.ts's embedSingleFile). Before this was unified, it existed
 * as four independent copies of the same rule; three of them lacked the doc-source
 * exemption despite comments in two of them explicitly (and wrongly) asserting docs
 * could never false-positive. Pure logic, no I/O — LoadedContext objects are built
 * in-memory directly rather than through loadContexts().
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quarantineMismatches, type LoadedContext } from '../lib/embedding/context-loader.js';

function makeContext(overrides: Partial<LoadedContext> = {}): LoadedContext {
  return {
    id: 'id',
    absPath: '/abs/id.md',
    relPath: 'id.md',
    name: 'id',
    description: '',
    type: 'unknown',
    tags: [],
    content: 'body',
    mtime: 0,
    ...overrides
  };
}

test('quarantineMismatches: a docs-typed source is never quarantined, even with a real mismatch', () => {
  // The exact real-world shape that triggered this bug: a free-form docs file
  // whose name happens to start with a valid category word ("project"), with a
  // declared type that legitimately differs.
  const ctx = makeContext({ relPath: 'project-quirks.md', type: 'reference' });
  const result = quarantineMismatches([ctx], 'doc');
  assert.deepEqual(result.quarantined, []);
  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0], ctx);
});

test('quarantineMismatches: a context-typed source still catches a real mismatch', () => {
  const ctx = makeContext({ relPath: 'decisions/decision-mismatched.md', type: 'gotcha' });
  const result = quarantineMismatches([ctx], 'context');
  assert.deepEqual(result.quarantined, ['decisions/decision-mismatched.md']);
  assert.equal(result.contexts.length, 0);
});

test('quarantineMismatches: undefined sourceType defaults to context-style checking (unchanged behavior)', () => {
  // Every pre-existing call site that predates this fix passed no sourceType at
  // all -- confirms the default doesn't silently exempt everything.
  const ctx = makeContext({ relPath: 'decisions/decision-mismatched.md', type: 'gotcha' });
  const result = quarantineMismatches([ctx]);
  assert.equal(result.quarantined.length, 1);
});

test('quarantineMismatches: a file with no declared type is never quarantined, regardless of sourceType', () => {
  const ctx = makeContext({ relPath: 'project-quirks.md', type: 'unknown' });
  const contextResult = quarantineMismatches([ctx], 'context');
  const docResult = quarantineMismatches([ctx], 'doc');
  assert.deepEqual(contextResult.quarantined, []);
  assert.deepEqual(docResult.quarantined, []);
});

test('quarantineMismatches: a matching prefix/type pair is never quarantined', () => {
  const ctx = makeContext({ relPath: 'decisions/decision-foo.md', type: 'decision' });
  const result = quarantineMismatches([ctx], 'context');
  assert.deepEqual(result.quarantined, []);
  assert.equal(result.contexts.length, 1);
});
