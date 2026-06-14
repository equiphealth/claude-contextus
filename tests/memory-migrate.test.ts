/**
 * Memory→Context migration mapping tests — slug→prefix rename, type inference,
 * tag preservation, folder placement, idempotent-safe target naming. Pure logic
 * (no disk I/O; the script wraps these with file ops + safety).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFile, kebab, type MemoryFile } from '../lib/capture/memory-migrate.js';

function mem(filename: string, data: Record<string, unknown>, body = 'body text'): MemoryFile {
  return { filename, data, body };
}

test('kebab: lowercases and collapses non-alnum runs', () => {
  assert.equal(kebab('Build Execution_Cadence'), 'build-execution-cadence');
  assert.equal(kebab('  Foo!!Bar  '), 'foo-bar');
});

test('planFile: legacy decision_ file → decisions/decision-<slug>.md', () => {
  const item = planFile(
    mem('decision_build_execution_cadence.md', {
      name: 'build-execution-cadence',
      description: 'how to run the build',
      metadata: { type: 'decision' },
    })
  );
  assert.equal(item.toRelPath, 'decisions/decision-build-execution-cadence.md');
  assert.equal(item.type, 'decision');
  assert.equal(item.slug, 'build-execution-cadence');
});

test('planFile: target frontmatter uses nested metadata schema', () => {
  const item = planFile(
    mem('feedback_x.md', { name: 'x', description: 'd', metadata: { type: 'feedback' } })
  );
  assert.match(item.content, /metadata:\n {2}type: feedback/);
  assert.match(item.content, /^---\n/);
});

test('planFile: existing tags are preserved, never fabricated', () => {
  const tagged = planFile(
    mem('decision_floor.md', {
      name: 'floor-calibration-signals',
      description: 'd',
      metadata: { type: 'decision', tags: ['calibration', 'retrieval'] },
    })
  );
  assert.deepEqual(tagged.tags, ['calibration', 'retrieval']);
  assert.match(tagged.content, /tags: \[calibration, retrieval\]/);

  const untagged = planFile(mem('project_x.md', { name: 'x', metadata: { type: 'project' } }));
  assert.deepEqual(untagged.tags, []);
  assert.doesNotMatch(untagged.content, /tags:/);
  assert.ok(untagged.notes.some((n) => /no tags/.test(n)));
});

test('planFile: type inferred from filename prefix when frontmatter lacks it', () => {
  const item = planFile(mem('reference_lancedb_connect.md', { name: 'lancedb-connect' }));
  assert.equal(item.type, 'reference');
  assert.ok(item.notes.some((n) => /inferred from filename prefix/.test(n)));
});

test('planFile: unknown prefix + no type → defaults to reference with a note', () => {
  const item = planFile(mem('randomthing.md', { name: 'random' }));
  assert.equal(item.type, 'reference');
  assert.ok(item.notes.some((n) => /defaulted to reference/.test(n)));
});

test('planFile: never double-prefixes the slug (decision- under type decision)', () => {
  const item = planFile(
    mem('decision_decision_foo.md', { name: 'decision-foo', metadata: { type: 'decision' } })
  );
  assert.equal(item.slug, 'foo');
  assert.equal(item.toRelPath, 'decisions/decision-foo.md');
});

test('planFile: filename head forced to equal type (prefix↔type gate will pass)', () => {
  const item = planFile(
    mem('decision_x.md', { name: 'some-name', metadata: { type: 'decision' } })
  );
  const head = item.toRelPath.split('/')[1].split('-')[0];
  assert.equal(head, item.type);
});
