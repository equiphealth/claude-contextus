/**
 * loadContexts glob/exclude tests — regression guard for the "phantom new file"
 * bug (2026-06-15): with an ABSOLUTE glob pattern, a globstar CONTEXT.md ignore
 * failed to exclude a ROOT-level CONTEXT.md, so reconcile counted the generated
 * index as a perpetual "new" file ("re-embedding 1" every session, embedding
 * nothing). loadContexts must exclude CONTEXT.md/README.md at any depth.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadContexts } from '../lib/embedding/context-loader.js';

function mkContextDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-loader-'));
  const ctx = path.join(dir, '.claude', 'context');
  fs.mkdirSync(path.join(ctx, 'decisions'), { recursive: true });
  // root-level index files (must be excluded)
  fs.writeFileSync(path.join(ctx, 'CONTEXT.md'), '# Context Index\n- listing');
  fs.writeFileSync(path.join(ctx, 'README.md'), '# readme');
  // a nested CONTEXT.md too (must also be excluded)
  fs.writeFileSync(path.join(ctx, 'decisions', 'CONTEXT.md'), '# nested index');
  // real content files
  fs.writeFileSync(
    path.join(ctx, 'decisions', 'decision-foo.md'),
    '---\nname: foo\nmetadata:\n  type: decision\n---\nbody'
  );
  fs.writeFileSync(
    path.join(ctx, 'reference-bar.md'),
    '---\nname: bar\nmetadata:\n  type: reference\n---\nbody'
  );
  return ctx;
}

test('loadContexts: excludes root AND nested CONTEXT.md / README.md', async () => {
  const ctx = mkContextDir();
  try {
    const loaded = await loadContexts(ctx);
    const ids = loaded.map((c) => c.id).sort();
    // only the two real files survive
    assert.deepEqual(ids, ['decisions/decision-foo.md', 'reference-bar.md']);
    // explicit: no index/readme leaked in at any depth
    assert.ok(!ids.some((id) => id.endsWith('CONTEXT.md')), 'CONTEXT.md must be excluded');
    assert.ok(!ids.some((id) => id.endsWith('README.md')), 'README.md must be excluded');
  } finally {
    fs.rmSync(path.dirname(path.dirname(ctx)), { recursive: true, force: true });
  }
});

test('loadContexts: missing dir → empty array', async () => {
  const loaded = await loadContexts('/nonexistent/path/.claude/context');
  assert.deepEqual(loaded, []);
});

test('loadContexts: custom exclude excludes DOCS.md, not the default CONTEXT.md/README.md', async () => {
  // Regression for GH issue #22: runReconcile used to always call loadContexts()
  // with no exclude arg, so a projectDocs source's DOCS.md leaked in as content.
  // A caller reconciling a doc source must be able to pass ITS OWN exclude list.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-loader-'));
  try {
    fs.writeFileSync(path.join(dir, 'DOCS.md'), '# Docs Index\n- GUIDE.md');
    fs.writeFileSync(path.join(dir, 'GUIDE.md'), '# A real doc\nsome content');
    const loaded = await loadContexts(dir, ['**/DOCS.md', '**/README.md']);
    const ids = loaded.map((c) => c.id).sort();
    assert.deepEqual(ids, ['GUIDE.md']);
    assert.ok(!ids.some((id) => id.endsWith('DOCS.md')), 'DOCS.md must be excluded');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
