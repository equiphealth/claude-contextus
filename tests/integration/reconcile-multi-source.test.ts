/**
 * INTEGRATION — /reconcile and /notify across ALL enabled sources, not just
 * projectContext (GH issue #22).
 *
 * Three bugs fixed together here, all from the same root cause (daemon code
 * paths that only knew about `.claude/context/` even though the config always
 * listed `docs/` as a real, enabled `projectDocs` source):
 *
 * 1. `/reconcile {check: true}` only ever inspected projectContext, so a
 *    project whose ONLY drift was under `docs/` reported `state: 'fresh'`
 *    (wrong) — and since session-start's checkCorpus() gates the REAL
 *    reconcile (which is what arms the live fs.watch per source) on this
 *    check, docs/ never got watched that session either.
 * 2. `runReconcile` (used by both check-mode's twin and the real reconcile)
 *    excluded only CONTEXT.md/README.md, never DOCS.md — so reconciling the
 *    projectDocs source would count/embed DOCS.md itself as real document
 *    content.
 * 3. `/notify`'s `determineSource()` only matched `.claude/context/`-shaped
 *    paths (mirrored in `scripts/watch-contexts.js`'s old `isContextFile`),
 *    so an edit under `docs/` never triggered a re-embed at all.
 *
 * The routing fix (#3) is tested by calling `determineSource()` directly
 * (now exported) rather than through the full `/notify` HTTP path: /notify
 * is hook-triggered, so it correctly degrades to `{continue: true}` on ANY
 * internal failure — including the embedding provider being unreachable,
 * which `embedSingleFile` hits unconditionally (it calls the real embedder,
 * with no environment-specific skip). That makes "did routing succeed"
 * unobservable from the HTTP response alone in a CI environment with no
 * Ollama/Transformers available. `determineSource` is a pure decision
 * function (config + path matching, no embedder/LanceDB I/O), so testing it
 * directly sidesteps that entirely.
 *
 * The /reconcile tests below DO boot the real `requestHandler` and hit real
 * LanceDB (check mode never calls the embedder, so no provider is needed).
 *
 * Run via `pnpm test:integration` (not the fast `pnpm test` suite).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-home-'));
process.env.HOME = homeDir;

const { requestHandler } = await import('../../daemon/server.js');

let projectDir: string;
let server: http.Server;
let baseUrl: string;

before(async () => {
  server = http.createServer(requestHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(homeDir, { recursive: true, force: true });
});

async function post(urlPath: string, body: string): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('/reconcile {check:true} counts a NEW projectDocs file, not just projectContext', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  // A real context file AND a real doc file — both "new" (no table exists yet).
  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-foo.md'),
    '---\nname: foo\nmetadata:\n  type: decision\n---\nbody'
  );
  fs.writeFileSync(path.join(docsDir, 'GUIDE.md'), '# A real doc\nsome content');
  // The doc source's own index file — must NEVER be counted as a "new" doc.
  fs.writeFileSync(path.join(docsDir, 'DOCS.md'), '# Docs Index\n- GUIDE.md');

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  // No table exists yet for this project → 'missing' takes priority over any
  // per-source 'stale'/'fresh' — this is the aggregated state across sources.
  assert.equal(json.state, 'missing');
  // 1 context file + 1 real doc file = 2. If DOCS.md leaked in, this would be 3.
  assert.equal(json.newCount, 2, 'DOCS.md must not count as a new document');
  // Piggybacked config (GH issue #39) — the properly MERGED transcriptMining
  // setting, defaulting to disabled since this project has no override.
  assert.deepEqual(json.transcriptMining, { enabled: false, intervalHours: 24 });

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} does not quarantine a projectDocs file whose name coincidentally matches a category prefix', async () => {
  // Regression for a real bug: categoryPrefix() is a pure filename matcher with no
  // source-type awareness -- a docs file named `project-quirks.md` collides with the
  // `project` metadata.type purely by naming coincidence. Only context-style sources
  // should ever be subject to the <type>-<slug>.md prefix/type consistency check;
  // docs are free-form (observed live in a real project; fixed directly in PR #65,
  // no separate tracking issue was filed).
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  // Docs file whose name happens to start with a valid category word ("project-"),
  // with a declared type that legitimately differs -- this is exactly the shape that
  // false-positives if the source-type guard is missing.
  fs.writeFileSync(
    path.join(docsDir, 'project-quirks.md'),
    '---\nname: project-quirks\nmetadata:\n  type: reference\n---\nsome quirky project notes'
  );

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(json.quarantined.length, 0, 'a docs file must never be quarantined');
  assert.equal(json.newCount, 1, 'the docs file should still count as embeddable');

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} DOES quarantine a projectContext file with a real prefix/type mismatch', async () => {
  // Same scenario, but in a real context-style source -- this one legitimately
  // should be caught, confirming the docs exemption didn't just disable the check
  // everywhere.
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });

  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-mismatched.md'),
    '---\nname: mismatched\nmetadata:\n  type: gotcha\n---\nbody'
  );

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(
    json.quarantined.length,
    1,
    'a real context prefix/type mismatch must still be caught'
  );
  assert.match(json.quarantined[0], /decision-mismatched\.md$/);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} isolates a file with invalid frontmatter YAML instead of failing the whole batch', async () => {
  // Regression (2026-10-14): loadContexts() used a bare .map(loadContext),
  // so one file with unparseable frontmatter (an unquoted ": " in a scalar)
  // threw and killed the ENTIRE reconcile for every source, not just that
  // file — observed live. A good file sitting right next to the bad one
  // must still be counted and embeddable; the bad one surfaces in `failed`,
  // distinct from `quarantined` (that's a different failure stage — this
  // file never even parses into a LoadedContext).
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });

  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-good.md'),
    '---\nname: good\nmetadata:\n  type: decision\n---\nbody'
  );
  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-bad.md'),
    '---\nname: bad\ndescription: unquoted: colon breaks this\nmetadata:\n  type: decision\n---\nbody'
  );

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(json.newCount, 1, 'the good file must still be counted as embeddable');
  assert.equal(json.quarantined.length, 0, 'not a prefix/type mismatch');
  assert.equal(json.failed.length, 1);
  assert.match(json.failed[0], /decision-bad\.md$/);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} reports BOTH a prefix/type mismatch AND invalid YAML in the same batch, independently', async () => {
  // The two failure classes are detected at different stages (quarantine
  // happens AFTER a file successfully parses into a LoadedContext; a YAML
  // parse failure means it never gets that far) and surface in separate
  // fields. Neither should mask, suppress, or get confused with the other —
  // a project can have one of each at the same time and both must show up,
  // each correctly attributed to its own field.
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  fs.mkdirSync(path.join(contextDir, 'decisions'), { recursive: true });

  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-good.md'),
    '---\nname: good\nmetadata:\n  type: decision\n---\nbody'
  );
  // Wrong category: filename prefix says "decision", frontmatter says "gotcha".
  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-mismatched.md'),
    '---\nname: mismatched\nmetadata:\n  type: gotcha\n---\nbody'
  );
  // Bad YAML: unquoted ": " mid-scalar breaks frontmatter parsing entirely.
  fs.writeFileSync(
    path.join(contextDir, 'decisions', 'decision-bad-yaml.md'),
    '---\nname: bad-yaml\ndescription: unquoted: colon breaks this\nmetadata:\n  type: decision\n---\nbody'
  );

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(json.newCount, 1, 'only the good file is embeddable');
  assert.equal(json.quarantined.length, 1, 'the prefix/type mismatch must still be caught');
  assert.match(json.quarantined[0], /decision-mismatched\.md$/);
  assert.equal(json.failed.length, 1, 'the invalid-YAML file must still be caught');
  assert.match(json.failed[0], /decision-bad-yaml\.md$/);
  // Cross-check: neither list leaked the other's file.
  assert.ok(!json.quarantined[0].includes('bad-yaml'));
  assert.ok(!json.failed[0].includes('mismatched'));

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} reports state:fresh when nothing changed across any source', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const contextDir = path.join(projectDir, '.claude', 'context');
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(contextDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });
  // No files under either source dir at all — diskFiles.length === 0 → 'empty'
  // for every source, so the aggregate must also be 'empty', not 'missing'.

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.equal(json.state, 'empty');
  assert.equal(json.newCount, 0);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile {check:true} reflects a project-level transcriptMining override', async () => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, '.claude', 'context'), { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, '.claude', 'contextus.json'),
    JSON.stringify({ config: { transcriptMining: { enabled: true, intervalHours: 6 } } })
  );

  const { status, json } = await post(
    '/reconcile',
    JSON.stringify({ cwd: projectDir, check: true })
  );

  assert.equal(status, 200);
  assert.deepEqual(json.transcriptMining, { enabled: true, intervalHours: 6 });

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('/reconcile (non-check) busy-guard agrees across project-name and cwd-only representations of the same project', async () => {
  // Regression for GH issue #56, as redesigned after PR #67 review: the guard
  // is keyed by the source's absolute directory path (reconcilingSources), not
  // by any caller-supplied project label — so two /reconcile calls for the
  // SAME cwd must report 'busy' regardless of how `project` is (or isn't)
  // specified, since the path is derived purely from cwd + the source's
  // configured relative path. Seeds the guard directly (see
  // __test_seedReconcilingSource's doc comment) since the real busy path only
  // populates it after a modelLoaded check this suite can't satisfy without a
  // live embedding provider.
  const { __test_seedReconcilingSource, __test_clearReconcilingSources } =
    await import('../../daemon/server.js');
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, '.claude', 'context'), { recursive: true });

  const sourcePath = path.join(projectDir, '.claude', 'context');
  __test_seedReconcilingSource(sourcePath);

  try {
    const byFriendlyName = await post(
      '/reconcile',
      JSON.stringify({ cwd: projectDir, project: path.basename(projectDir) })
    );
    const byCwdOnly = await post('/reconcile', JSON.stringify({ cwd: projectDir }));

    assert.equal(
      byFriendlyName.json.state,
      'busy',
      'a friendly-name call must see the in-flight guard'
    );
    assert.equal(
      byCwdOnly.json.state,
      'busy',
      'a cwd-only call for the same project must see it too'
    );
  } finally {
    __test_clearReconcilingSources();
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('determineSource routes a docs/ file to the projectDocs source, not just .claude/context/', async () => {
  const { determineSource } = await import('../../daemon/server.js');
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  const docsDir = path.join(projectDir, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const absFile = path.join(docsDir, 'GUIDE.md');
  fs.writeFileSync(absFile, '# A real doc\nsome content');

  // Before the fix, determineSource only matched .claude/context/-shaped
  // paths and this would return null (routed nowhere).
  const result = determineSource(absFile, projectDir, undefined);

  assert.ok(result, 'docs/ must resolve to a real source, not null');
  assert.equal(result!.sourceName, 'projectDocs');
  assert.equal(result!.sourceDir, docsDir);

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('determineSource resolves a friendly project name to the canonical hash, not the raw label', async () => {
  // Regression for GH issue #56: determineSource used to return
  // `project ?? projectHash(cwd)` verbatim as `projectId` for project-scoped
  // sources — so calling with a friendly name returned that NAME as the
  // "projectId", not its canonical hash. Since projectId feeds both storage
  // scoping (embedSingleFile/getContentHashes) and the reconcilingProjects
  // dedup guard (via the reconcileKey threaded through watchContextDir), two
  // calls for the same project — one by name, one by hash or cwd alone —
  // would disagree on identity and let concurrent reconciles race past the
  // guard.
  const { determineSource } = await import('../../daemon/server.js');
  const { registerProject, resolveProjectId } = await import('../../lib/workspace.js');
  const { projectHash } = await import('../../lib/config.js');

  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, '.claude', 'context'), { recursive: true });
  const canonicalId = projectHash(projectDir);
  registerProject(canonicalId, projectDir);
  const friendlyName = path.basename(projectDir);
  assert.equal(
    resolveProjectId(friendlyName),
    canonicalId,
    'sanity: name must resolve to the hash'
  );

  const absFile = path.join(projectDir, '.claude', 'context', 'decisions', 'decision-foo.md');
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.writeFileSync(absFile, '---\nname: foo\nmetadata:\n  type: decision\n---\nbody');

  const byName = determineSource(absFile, projectDir, friendlyName);
  const byNothing = determineSource(absFile, projectDir, undefined);

  assert.ok(byName && byNothing);
  assert.equal(
    byName!.projectId,
    canonicalId,
    'a friendly-name call must resolve to the canonical hash'
  );
  assert.equal(
    byName!.projectId,
    byNothing!.projectId,
    'name-based and cwd-only calls for the same project must agree on projectId'
  );

  fs.rmSync(projectDir, { recursive: true, force: true });
});

test('determineSource still returns null for a file outside every configured source', async () => {
  const { determineSource } = await import('../../daemon/server.js');
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-itest-project-'));
  fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
  const absFile = path.join(projectDir, 'src', 'notes.md');
  fs.writeFileSync(absFile, '# unrelated notes');

  const result = determineSource(absFile, projectDir, undefined);

  assert.equal(result, null);

  fs.rmSync(projectDir, { recursive: true, force: true });
});
