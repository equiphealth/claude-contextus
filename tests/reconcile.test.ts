/**
 * Reconcile planner unit tests — the cold/stale corpus detection that drives
 * first-run auto-reconcile. Pure logic, no daemon/embedder.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planReconcile, type DiskFile } from '../lib/storage/reconcile.js';
import { contentHash } from '../lib/storage/staleness.js';

function file(id: string, content: string): DiskFile {
  return { id, absPath: `/ctx/${id}`, content };
}

test('missing: no table → state missing, everything is new', () => {
  const disk = [file('a.md', 'alpha'), file('b.md', 'beta')];
  const plan = planReconcile(disk, new Map(), false);
  assert.equal(plan.state, 'missing');
  assert.deepEqual(plan.toEmbedNew.sort(), ['a.md', 'b.md']);
  assert.equal(plan.toEmbedChanged.length, 0);
  assert.equal(plan.embedPaths.length, 2);
});

test('empty: no files on disk → state empty even with a table', () => {
  const plan = planReconcile([], new Map([['gone.md', 'h']]), true);
  assert.equal(plan.state, 'empty');
  // orphans are still reported, but state is empty (nothing to embed)
  assert.deepEqual(plan.toRemove, ['gone.md']);
});

test('fresh: table hashes match disk → state fresh, no work', () => {
  const disk = [file('a.md', 'alpha')];
  const hashes = new Map([['a.md', contentHash('alpha')]]);
  const plan = planReconcile(disk, hashes, true);
  assert.equal(plan.state, 'fresh');
  assert.equal(plan.embedPaths.length, 0);
  assert.deepEqual(plan.unchanged, ['a.md']);
});

test('stale: a changed file → state stale, only the changed one re-embeds', () => {
  const disk = [file('a.md', 'alpha-EDITED'), file('b.md', 'beta')];
  const hashes = new Map([
    ['a.md', contentHash('alpha')], // changed
    ['b.md', contentHash('beta')] // unchanged
  ]);
  const plan = planReconcile(disk, hashes, true);
  assert.equal(plan.state, 'stale');
  assert.deepEqual(plan.toEmbedChanged, ['a.md']);
  assert.deepEqual(plan.unchanged, ['b.md']);
  assert.deepEqual(plan.embedPaths, ['/ctx/a.md']);
});

test('stale: a new file alongside unchanged ones', () => {
  const disk = [file('a.md', 'alpha'), file('new.md', 'fresh')];
  const hashes = new Map([['a.md', contentHash('alpha')]]);
  const plan = planReconcile(disk, hashes, true);
  assert.equal(plan.state, 'stale');
  assert.deepEqual(plan.toEmbedNew, ['new.md']);
  assert.deepEqual(plan.unchanged, ['a.md']);
});

test('stale: an orphan row (file deleted) → toRemove, state stale', () => {
  const disk = [file('a.md', 'alpha')];
  const hashes = new Map([
    ['a.md', contentHash('alpha')],
    ['deleted.md', contentHash('whatever')]
  ]);
  const plan = planReconcile(disk, hashes, true);
  assert.equal(plan.state, 'stale');
  assert.deepEqual(plan.toRemove, ['deleted.md']);
  assert.equal(plan.embedPaths.length, 0); // nothing to embed, just remove
});

test('orphan-only stale: nothing to embed (the "re-embedding 0" guard)', () => {
  // Regression: the daemon /reconcile check once passed UNFILTERED hashes (all
  // sources), so doc/user-pack rows looked like orphans of the context dir →
  // state 'stale' with newCount+changedCount=0 and a nonsense "re-embedding 0"
  // session-start line. The planner must report this as embed-work-free so the
  // hook can reconcile quietly. (The real fix is scoping hashes to projectContext;
  // this locks in that an orphan-only plan has zero embed work.)
  const disk = [file('a.md', 'alpha'), file('b.md', 'beta')];
  const hashes = new Map([
    ['a.md', contentHash('alpha')],
    ['b.md', contentHash('beta')],
    ['orphan-doc.md', contentHash('x')] // a row with no disk file (wrong-scope leak)
  ]);
  const plan = planReconcile(disk, hashes, true);
  assert.equal(plan.state, 'stale');
  assert.equal(plan.toEmbedNew.length + plan.toEmbedChanged.length, 0, 'no embed work');
  assert.deepEqual(plan.toRemove, ['orphan-doc.md']);
});
