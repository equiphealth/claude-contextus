/**
 * Memory→Context migration mapping tests — slug→prefix rename, type inference,
 * tag preservation, folder placement, idempotent-safe target naming. Pure logic
 * (no disk I/O; the script wraps these with file ops + safety).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planFile,
  planMigration,
  kebab,
  reclassifyFeedback,
  renderContextIndex,
  type MemoryFile
} from '../lib/capture/memory-migrate.js';

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
      metadata: { type: 'decision' }
    })
  );
  assert.equal(item.toRelPath, 'decisions/decision-build-execution-cadence.md');
  assert.equal(item.type, 'decision');
  assert.equal(item.slug, 'build-execution-cadence');
});

test('planFile: target frontmatter uses nested metadata schema', () => {
  const item = planFile(
    mem('decision_x.md', { name: 'x', description: 'd', metadata: { type: 'decision' } })
  );
  assert.match(item.content, /metadata:\n {2}type: decision/);
  assert.match(item.content, /^---\n/);
});

test('planFile: existing tags are preserved, never fabricated', () => {
  const tagged = planFile(
    mem('decision_floor.md', {
      name: 'floor-calibration-signals',
      description: 'd',
      metadata: { type: 'decision', tags: ['calibration', 'retrieval'] }
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

test('reclassifyFeedback: pitfall language → gotcha', () => {
  const g = reclassifyFeedback(
    mem('feedback_ios_quirk.md', {
      name: 'ios-isdisplayed-quirk',
      description: 'iOS isDisplayed() can return false for visually present elements'
    })
  );
  assert.equal(g.type, 'gotcha');
});

test('reclassifyFeedback: AI-process meta → reference', () => {
  const r = reclassifyFeedback(
    mem('feedback_check_claude_mem_first.md', {
      name: 'check-claude-mem-first',
      description: 'Search claude-mem for related past work before diving into code'
    })
  );
  assert.equal(r.type, 'reference');
});

test('reclassifyFeedback: resolved convention → decision (default)', () => {
  const d = reclassifyFeedback(
    mem('feedback_use_logger.md', {
      name: 'use-logger-helper',
      description: 'Always use getLogger() helper instead of console.log'
    })
  );
  assert.equal(d.type, 'decision');
});

test('planFile: banned feedback type is reclassified, never emitted as feedback', () => {
  const item = planFile(
    mem('feedback_use_logger.md', {
      name: 'use-logger-helper',
      description: 'Always use getLogger() helper',
      metadata: { type: 'feedback' }
    })
  );
  assert.notEqual(item.type, 'feedback');
  assert.equal(item.type, 'decision');
  assert.equal(item.toRelPath, 'decisions/decision-use-logger-helper.md');
  assert.doesNotMatch(item.content, /type: feedback/);
});

test('planFile: filename head forced to equal type (prefix↔type gate will pass)', () => {
  const item = planFile(
    mem('decision_x.md', { name: 'some-name', metadata: { type: 'decision' } })
  );
  const head = item.toRelPath.split('/')[1].split('-')[0];
  assert.equal(head, item.type);
});

test('renderContextIndex: groups by type, links each file, lists every entry', () => {
  const plan = planMigration([
    mem('decision_use_logger.md', {
      name: 'use-logger',
      description: 'use the logger',
      metadata: { type: 'decision' }
    }),
    mem('feedback_ios_quirk.md', {
      name: 'ios-quirk',
      description: 'isDisplayed quirk',
      metadata: { type: 'feedback' } // reclassified → gotcha
    }),
    mem('reference_accounts.md', { name: 'accounts', description: 'where accounts live' })
  ]);
  const idx = renderContextIndex(plan);

  assert.match(idx, /^# Context Index/);
  assert.match(
    idx,
    /## Decisions\n\n- \[use-logger\]\(decisions\/decision-use-logger\.md\) — use the logger/
  );
  assert.match(idx, /## Gotchas\n\n- \[ios-quirk\]\(gotchas\/gotcha-ios-quirk\.md\)/);
  assert.match(idx, /## Reference\n\n- \[accounts\]\(reference\/reference-accounts\.md\)/);
  // every plan item appears exactly once
  for (const it of plan) {
    const occurrences = idx.split(`(${it.toRelPath})`).length - 1;
    assert.equal(occurrences, 1, `${it.toRelPath} should appear once`);
  }
});

test('renderContextIndex: unknown type lands under Other, never dropped', () => {
  // A file whose frontmatter type isn't a known section heading.
  const plan = planMigration([
    mem('weird_thing.md', { name: 'weird', description: 'd', metadata: { type: 'implementation' } })
  ]);
  const idx = renderContextIndex(plan);
  // implementation IS known; assert it's placed, then synthesize a truly-unknown one.
  assert.match(idx, /## Implementation/);

  const orphan = planMigration([mem('x.md', { name: 'x', description: 'd' })]);
  orphan[0].type = 'mystery';
  const idx2 = renderContextIndex(orphan);
  assert.match(idx2, /## Other\n\n- \[x\]/);
});
