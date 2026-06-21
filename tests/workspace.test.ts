/**
 * Workspace + projectHash tests — covers the unified DB project hashing
 * and workspace resolution logic (loadWorkspaces, resolveProjectScope,
 * addProjectToWorkspace, removeProjectFromWorkspace, workspacesForProject).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
  listWorkspaceNames
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
