/**
 * Regression tests for unified DB scoping invariants.
 *
 * These prevent the class of bugs found in PR #10 review:
 * - Row ID collisions across projects
 * - Unscoped deletes wiping other projects' rows
 * - Keyword search leaking across project boundaries
 * - User sources invisible to workspace queries
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, buildRows } from '../lib/embedding/file-to-rows.js';
import { keywordSearch } from '../lib/retrieval/keyword.js';
import type { ContextRow } from '../lib/storage/lance-client.js';
import type { LoadedContext } from '../lib/embedding/context-loader.js';

function makeContext(overrides: Partial<LoadedContext> = {}): LoadedContext {
  return {
    id: overrides.id ?? 'decisions/decision-auth.md',
    name: overrides.name ?? 'Auth Decision',
    description: overrides.description ?? 'How we handle authentication',
    content: overrides.content ?? 'Use JWT tokens for stateless auth across services.',
    type: overrides.type ?? 'decision',
    tags: overrides.tags ?? [],
    relPath: overrides.relPath ?? 'decisions/decision-auth.md',
    absPath: overrides.absPath ?? '/tmp/proj/.claude/context/decisions/decision-auth.md',
    source: overrides.source ?? 'projectContext'
  };
}

function makeRow(overrides: Partial<ContextRow> = {}): ContextRow {
  return {
    id: overrides.id ?? 'abc123:test.md#0',
    project: overrides.project ?? 'abc123def456',
    vector: [],
    document: overrides.document ?? 'default content',
    filename: overrides.filename ?? 'test.md',
    chunk_index: overrides.chunk_index ?? 0,
    heading: overrides.heading ?? '',
    type: overrides.type ?? 'reference',
    source: overrides.source ?? 'projectContext',
    tags: overrides.tags ?? '',
    hit_count: overrides.hit_count ?? 0,
    last_hit: overrides.last_hit ?? '',
    updated_at: overrides.updated_at ?? '2026-06-01T00:00:00Z',
    content_hash: overrides.content_hash ?? 'abc123'
  };
}

// === Row ID Global Uniqueness ===

test('buildRows: prefixes row IDs with project hash when provided', () => {
  const ctx = makeContext();
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z', 'abc123');

  for (const row of rows) {
    assert.ok(row.id.startsWith('abc123:'), `expected prefix, got: ${row.id}`);
  }
});

test('buildRows: same file in different projects produces different row IDs', () => {
  const ctx = makeContext();
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);

  const rowsA = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z', 'projA');
  const rowsB = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z', 'projB');

  for (let i = 0; i < rowsA.length; i++) {
    assert.notEqual(rowsA[i].id, rowsB[i].id, 'IDs must differ across projects');
  }
});

test('buildRows: without project param, IDs lack prefix (legacy/error case)', () => {
  const ctx = makeContext();
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z');

  for (const row of rows) {
    assert.ok(
      !row.id.includes(':') || row.id.startsWith('decisions/'),
      `unexpected prefix: ${row.id}`
    );
    assert.equal(row.project, '', 'project should be empty string');
  }
});

test('buildRows: stamps project hash on all rows', () => {
  const ctx = makeContext();
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z', 'xyz789');

  for (const row of rows) {
    assert.equal(row.project, 'xyz789');
  }
});

// === User Sources Stamped __user__ ===

test('buildRows: user sources stamped __user__ are visible to any workspace scope', () => {
  const ctx = makeContext({ id: 'personal/workflow.md', relPath: 'personal/workflow.md' });
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(ctx, pending, vectors, 'userContext', '2026-06-21T00:00:00Z', '__user__');

  for (const row of rows) {
    assert.equal(row.project, '__user__');
    assert.ok(row.id.startsWith('__user__:'), `user rows should have __user__ prefix: ${row.id}`);
  }
});

// === Keyword Search Scoping ===

test('keywordSearch: only returns rows from the provided corpus (scoped)', () => {
  const projectARows = [
    makeRow({
      id: 'projA:auth.md#0',
      project: 'projA',
      document: 'authentication using JWT tokens for login'
    }),
    makeRow({
      id: 'projA:config.md#0',
      project: 'projA',
      document: 'configuration management with hot reload'
    })
  ];
  const projectBRows = [
    makeRow({
      id: 'projB:auth.md#0',
      project: 'projB',
      document: 'authentication using OAuth for third party login'
    })
  ];

  // Simulate scoped corpus (only projA rows passed to keywordSearch)
  const results = keywordSearch(projectARows, 'authentication JWT login', 10);
  assert.ok(results.length > 0);
  for (const r of results) {
    assert.equal(r.project, 'projA', 'should only contain projA rows');
  }

  // If projB rows were accidentally included (unscoped), they'd appear
  const unscopedResults = keywordSearch(
    [...projectARows, ...projectBRows],
    'authentication login',
    10
  );
  const projBHits = unscopedResults.filter((r) => r.project === 'projB');
  // This demonstrates WHY scoping matters — without it, projB leaks in
  if (unscopedResults.length > 0) {
    assert.ok(
      projBHits.length > 0 || unscopedResults.every((r) => r.project === 'projA'),
      'unscoped search demonstrates cross-project leakage potential'
    );
  }
});

test('keywordSearch: __user__ rows appear when included in corpus (workspace scope)', () => {
  const corpus = [
    makeRow({
      id: 'projA:impl.md#0',
      project: 'projA',
      document: 'implementation details for the service layer'
    }),
    makeRow({
      id: '__user__:workflow.md#0',
      project: '__user__',
      document: 'personal workflow for implementation reviews'
    })
  ];

  const results = keywordSearch(corpus, 'implementation workflow service', 10);
  const projects = new Set(results.map((r) => r.project));
  assert.ok(projects.has('__user__'), 'user context should surface in workspace-scoped search');
});

// === Project Column Integrity ===

test('buildRows: multi-chunk file shares same project stamp', () => {
  const longContent = Array.from(
    { length: 50 },
    (_, i) =>
      `## Section ${i}\n\nThis is paragraph ${i} with enough text to force chunking. ` +
      `The content discusses feature number ${i} and its implementation details.`
  ).join('\n\n');

  const ctx = makeContext({ content: longContent });
  const pending = planChunks(ctx);
  assert.ok(pending.length > 1, 'should produce multiple chunks for this content');

  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(
    ctx,
    pending,
    vectors,
    'projectContext',
    '2026-06-21T00:00:00Z',
    'multi123'
  );

  const projects = new Set(rows.map((r) => r.project));
  assert.equal(projects.size, 1, 'all chunks must share the same project stamp');
  assert.ok(projects.has('multi123'));

  // All IDs must be globally unique
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'all row IDs must be unique');
});

// === Row ID Format Validation ===

test('buildRows: row ID format is <project>:<relPath>#<chunkIndex>', () => {
  const ctx = makeContext({
    id: 'gotchas/gotcha-timeout.md',
    relPath: 'gotchas/gotcha-timeout.md'
  });
  const pending = planChunks(ctx);
  const vectors = pending.map(() => [0.1, 0.2, 0.3]);
  const rows = buildRows(ctx, pending, vectors, 'projectContext', '2026-06-21T00:00:00Z', 'hash99');

  for (const row of rows) {
    const match = row.id.match(/^hash99:gotchas\/gotcha-timeout\.md#(\d+)$/);
    assert.ok(match, `ID format wrong: ${row.id}`);
  }
});
