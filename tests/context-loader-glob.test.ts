/**
 * loadContexts glob/exclude tests — regression guard for the "phantom new file"
 * bug (2026-06-15): with an ABSOLUTE glob pattern, a globstar CONTEXT.md ignore
 * failed to exclude a ROOT-level CONTEXT.md, so reconcile counted the generated
 * index as a perpetual "new" file ("re-embedding 1" every session, embedding
 * nothing). loadContexts must exclude CONTEXT.md/README.md at any depth.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
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
