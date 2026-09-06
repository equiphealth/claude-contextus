/**
 * Workspace + projectHash tests — covers the unified DB project hashing
 * and workspace resolution logic (loadWorkspaces, resolveProjectScope,
 * addProjectToWorkspace, removeProjectFromWorkspace, workspacesForProject).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Set HOME before importing workspace module so expandHome('~/.contextus/workspaces')
// resolves to the temp dir. The module evaluates WORKSPACES_DIR at import time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-ws-test-'));
const originalHome = process.env.HOME;
process.env.HOME = tmp;

const { projectHash } = await import('../lib/config.js');
const {
  loadWorkspaces,
  resolveProjectScope,
  addProjectToWorkspace,
  removeProjectFromWorkspace,
  workspacesForProject,
  writeWorkspace,
  listWorkspaceNames,
  registerProject,
  projectPath,
  clearRegistryCache,
  isValidProjectDir
} = await import('../lib/workspace.js');

const WORKSPACES_DIR = path.join(tmp, '.contextus', 'workspaces');

before(() => {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
});

after(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// --- projectHash tests ---

test('projectHash: returns a 12-char hex string', () => {
  const hash = projectHash('/Users/test/my-project');
  assert.match(hash, /^[0-9a-f]{12}$/);
});

test('projectHash: is deterministic (same path = same hash)', () => {
  const a = projectHash('/Users/test/my-project');
  const b = projectHash('/Users/test/my-project');
  assert.equal(a, b);
});

test('projectHash: different paths produce different hashes', () => {
  const a = projectHash('/Users/test/project-alpha');
  const b = projectHash('/Users/test/project-beta');
  assert.notEqual(a, b);
});

test('projectHash: normalizes via path.resolve (trailing slash ignored)', () => {
  const a = projectHash('/Users/test/my-project');
  const b = projectHash('/Users/test/my-project/');
  assert.equal(a, b);
});

test('projectHash: normalizes relative segments (.. and .)', () => {
  const a = projectHash('/Users/test/my-project');
  const b = projectHash('/Users/test/other/../my-project');
  assert.equal(a, b);
});

// --- loadWorkspaces tests ---

test('loadWorkspaces: returns empty array when no workspace files exist', () => {
  // Clear any existing files
  const files = fs.readdirSync(WORKSPACES_DIR);
  for (const f of files) fs.unlinkSync(path.join(WORKSPACES_DIR, f));

  const result = loadWorkspaces();
  assert.deepEqual(result, []);
});

test('loadWorkspaces: parses JSONC workspace files', () => {
  const wsContent = `{
  // This is a comment
  "name": "test-workspace",
  "projects": [
    { "path": "/tmp/project-a" },
    { "path": "/tmp/project-b" }
  ]
}`;
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'test-workspace.jsonc'), wsContent);

  const result = loadWorkspaces();
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'test-workspace');
  assert.equal(result[0].projects.length, 2);
  assert.equal(result[0].projects[0].path, '/tmp/project-a');

  // Cleanup
  fs.unlinkSync(path.join(WORKSPACES_DIR, 'test-workspace.jsonc'));
});

test('loadWorkspaces: skips malformed files gracefully', () => {
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'bad.jsonc'), 'not valid json {{{');
  fs.writeFileSync(
    path.join(WORKSPACES_DIR, 'missing-name.jsonc'),
    JSON.stringify({ projects: [] })
  );

  const result = loadWorkspaces();
  assert.equal(result.length, 0);

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'bad.jsonc'));
  fs.unlinkSync(path.join(WORKSPACES_DIR, 'missing-name.jsonc'));
});

// --- resolveProjectScope tests ---

test('resolveProjectScope: project not in any workspace returns [selfHash, __user__]', () => {
  // Ensure no workspace files
  const files = fs.readdirSync(WORKSPACES_DIR);
  for (const f of files) fs.unlinkSync(path.join(WORKSPACES_DIR, f));

  const projectPath = '/tmp/standalone-project';
  const scope = resolveProjectScope(projectPath);
  const selfHash = projectHash(projectPath);

  assert.equal(scope.length, 2);
  assert.ok(scope.includes(selfHash));
  assert.ok(scope.includes('__user__'));
});

test('resolveProjectScope: project in a workspace includes sibling hashes', () => {
  const wsContent = JSON.stringify({
    name: 'shared',
    projects: [{ path: '/tmp/proj-x' }, { path: '/tmp/proj-y' }, { path: '/tmp/proj-z' }]
  });
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'shared.jsonc'), wsContent);

  const scope = resolveProjectScope('/tmp/proj-x');
  const hashX = projectHash('/tmp/proj-x');
  const hashY = projectHash('/tmp/proj-y');
  const hashZ = projectHash('/tmp/proj-z');

  assert.ok(scope.includes(hashX), 'should contain self hash');
  assert.ok(scope.includes(hashY), 'should contain sibling Y hash');
  assert.ok(scope.includes(hashZ), 'should contain sibling Z hash');
  assert.ok(scope.includes('__user__'), 'should contain __user__ sentinel');

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'shared.jsonc'));
});

// --- workspacesForProject tests ---

test('workspacesForProject: returns matching workspaces', () => {
  const ws1 = JSON.stringify({
    name: 'ws1',
    projects: [{ path: '/tmp/member' }, { path: '/tmp/other' }]
  });
  const ws2 = JSON.stringify({
    name: 'ws2',
    projects: [{ path: '/tmp/unrelated' }]
  });
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'ws1.jsonc'), ws1);
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'ws2.jsonc'), ws2);

  const result = workspacesForProject('/tmp/member');
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'ws1');

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'ws1.jsonc'));
  fs.unlinkSync(path.join(WORKSPACES_DIR, 'ws2.jsonc'));
});

// --- addProjectToWorkspace tests ---

test('addProjectToWorkspace: creates workspace if it does not exist', () => {
  // Ensure clean state
  const files = fs.readdirSync(WORKSPACES_DIR);
  for (const f of files) fs.unlinkSync(path.join(WORKSPACES_DIR, f));

  const ws = addProjectToWorkspace('new-ws', '/tmp/new-proj');
  assert.equal(ws.name, 'new-ws');
  assert.equal(ws.projects.length, 1);
  assert.equal(ws.projects[0].path, '/tmp/new-proj');

  // Verify file was written
  assert.ok(fs.existsSync(path.join(WORKSPACES_DIR, 'new-ws.jsonc')));

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'new-ws.jsonc'));
});

test('addProjectToWorkspace: does not duplicate an existing project', () => {
  const wsContent = JSON.stringify({
    name: 'dedup-ws',
    projects: [{ path: '/tmp/already-here' }]
  });
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'dedup-ws.jsonc'), wsContent);

  const ws = addProjectToWorkspace('dedup-ws', '/tmp/already-here');
  assert.equal(ws.projects.length, 1);

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'dedup-ws.jsonc'));
});

// --- removeProjectFromWorkspace tests ---

test('removeProjectFromWorkspace: removes a project and returns true', () => {
  const wsContent = JSON.stringify({
    name: 'rm-ws',
    projects: [{ path: '/tmp/keep' }, { path: '/tmp/remove-me' }]
  });
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'rm-ws.jsonc'), wsContent);

  const removed = removeProjectFromWorkspace('rm-ws', '/tmp/remove-me');
  assert.equal(removed, true);

  // Verify the file was updated
  const updated = loadWorkspaces().find((w) => w.name === 'rm-ws');
  assert.equal(updated!.projects.length, 1);
  assert.equal(updated!.projects[0].path, '/tmp/keep');

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'rm-ws.jsonc'));
});

test('removeProjectFromWorkspace: returns false for nonexistent workspace', () => {
  const files = fs.readdirSync(WORKSPACES_DIR);
  for (const f of files) fs.unlinkSync(path.join(WORKSPACES_DIR, f));

  const removed = removeProjectFromWorkspace('ghost-ws', '/tmp/anything');
  assert.equal(removed, false);
});

test('removeProjectFromWorkspace: returns false when project not in workspace', () => {
  const wsContent = JSON.stringify({
    name: 'partial-ws',
    projects: [{ path: '/tmp/only-this' }]
  });
  fs.writeFileSync(path.join(WORKSPACES_DIR, 'partial-ws.jsonc'), wsContent);

  const removed = removeProjectFromWorkspace('partial-ws', '/tmp/not-here');
  assert.equal(removed, false);

  fs.unlinkSync(path.join(WORKSPACES_DIR, 'partial-ws.jsonc'));
});

// --- registerProject validation tests ---
// A malformed cwd (relative path, nonexistent path, or a literal shell
// fragment like "$(pwd)") must never be persisted into the registry — it
// should silently no-op, not write garbage.

test('registerProject: persists a valid absolute, existing directory', () => {
  clearRegistryCache();
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-real-project-'));
  registerProject('validhash1', realDir);
  assert.equal(projectPath('validhash1'), path.resolve(realDir));
  fs.rmSync(realDir, { recursive: true, force: true });
});

test('registerProject: rejects a relative path (e.g. unexpanded "$(pwd)")', () => {
  clearRegistryCache();
  registerProject('badhash1', '$(pwd)');
  assert.equal(projectPath('badhash1'), null);
});

test('registerProject: rejects a nonexistent absolute path', () => {
  clearRegistryCache();
  registerProject('badhash2', '/tmp/definitely-does-not-exist-contextus-test');
  assert.equal(projectPath('badhash2'), null);
});

test('registerProject: rejects a path that is a file, not a directory', () => {
  clearRegistryCache();
  const realFile = path.join(tmp, 'not-a-directory.txt');
  fs.writeFileSync(realFile, 'hello');
  registerProject('badhash3', realFile);
  assert.equal(projectPath('badhash3'), null);
  fs.unlinkSync(realFile);
});

test('registerProject: no-ops silently on empty id or path (no throw)', () => {
  clearRegistryCache();
  assert.doesNotThrow(() => registerProject('', '/tmp'));
  assert.doesNotThrow(() => registerProject('somehash', ''));
});

// --- registry cache invalidation on external edit (#47) ---
// Repro: the registry was cached for the daemon's whole process lifetime;
// any out-of-band edit to projects.json was invisible until restart, and the
// next unrelated registerProject() call clobbered it back by writing out the
// stale in-memory snapshot. mtime-check invalidation (loadRegistry) should
// make external edits visible on the very next read, with no restart needed.

const REGISTRY_PATH = path.join(tmp, '.contextus', 'data', 'projects.json');

/** Externally edit the registry file the way a manual cleanup or another
 *  tool would — bypassing registerProject/saveRegistry entirely — then bump
 *  its mtime forward so filesystems with coarse mtime resolution still see
 *  a real change. */
function editRegistryExternally(mutate: (reg: Record<string, unknown>) => void): void {
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  mutate(raw);
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(raw, null, 2) + '\n');
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(REGISTRY_PATH, future, future);
}

test('registry: external edit to projects.json is visible on next read (no restart needed)', () => {
  clearRegistryCache();
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-ext-edit-'));
  registerProject('extedit1', realDir);
  assert.equal(projectPath('extedit1'), path.resolve(realDir));

  editRegistryExternally((reg) => delete reg['extedit1']);

  assert.equal(
    projectPath('extedit1'),
    null,
    'external removal should be visible without a restart'
  );
  fs.rmSync(realDir, { recursive: true, force: true });
});

test('registry: a subsequent unrelated write does not resurrect an externally-removed entry', () => {
  clearRegistryCache();
  const realDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-ext-edit-a-'));
  const realDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-ext-edit-b-'));
  registerProject('extedit2', realDirA);

  editRegistryExternally((reg) => delete reg['extedit2']);

  // Unrelated write — previously this dumped the stale in-memory snapshot
  // (still containing extedit2) back onto disk, resurrecting it (the exact
  // repro in #47).
  registerProject('extedit3', realDirB);

  assert.equal(
    projectPath('extedit2'),
    null,
    'unrelated write must not resurrect the externally-removed entry'
  );
  assert.equal(projectPath('extedit3'), path.resolve(realDirB));

  fs.rmSync(realDirA, { recursive: true, force: true });
  fs.rmSync(realDirB, { recursive: true, force: true });
});

// --- isValidProjectDir direct tests ---
// Every cwd-accepting daemon handler shares this one throw-safe check
// instead of each reimplementing existsSync+statSync inline.

test('isValidProjectDir: true for an absolute, existing directory', () => {
  assert.equal(isValidProjectDir(tmp), true);
});

test('isValidProjectDir: false for a relative path', () => {
  assert.equal(isValidProjectDir('$(pwd)'), false);
  assert.equal(isValidProjectDir('relative/path'), false);
});

test('isValidProjectDir: false for a nonexistent absolute path', () => {
  assert.equal(isValidProjectDir('/tmp/definitely-does-not-exist-contextus-test-2'), false);
});

test('isValidProjectDir: false for a file, not a directory', () => {
  const realFile = path.join(tmp, 'also-not-a-directory.txt');
  fs.writeFileSync(realFile, 'hello');
  assert.equal(isValidProjectDir(realFile), false);
  fs.unlinkSync(realFile);
});

test('isValidProjectDir: false (not throw) for empty string', () => {
  assert.doesNotThrow(() => isValidProjectDir(''));
  assert.equal(isValidProjectDir(''), false);
});

test('isValidProjectDir: false (not throw) on a path with no read permission on a parent dir', () => {
  // Best-effort: simulate the "statSync throws for a reason other than
  // ENOENT" case (permissions, transient deletion) that motivated wrapping
  // this in try/catch. A deeply nested nonexistent path exercises the same
  // catch branch without needing real permission manipulation in CI.
  assert.doesNotThrow(() => isValidProjectDir('/root/definitely/not/accessible/here'));
  assert.equal(isValidProjectDir('/root/definitely/not/accessible/here'), false);
});
