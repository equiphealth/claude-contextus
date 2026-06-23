/**
 * Unit tests for embedSingleFile early-exit paths.
 *
 * These test the pure guard logic that doesn't require LanceDB:
 * - outside_context_dir
 * - not_a_markdown_file
 * - index_or_readme (CONTEXT.md / README.md)
 *
 * The deletion/not_found paths require getContentHashes (LanceDB) so are
 * covered at the integration level by reconcile tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { embedSingleFile } from '../lib/embedding/embed-file.js';

/** Create a temp dir that acts as the .claude/context/ root. */
function makeTempContextDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-test-'));
}

test('embedSingleFile: returns outside_context_dir for path not under contextDir', async () => {
  const contextDir = makeTempContextDir();
  try {
    const outsidePath = path.join(os.tmpdir(), 'rogue-file.md');
    const result = await embedSingleFile(outsidePath, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'outside_context_dir');
    assert.equal(result.id, undefined);
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns outside_context_dir for sibling directory with same prefix', async () => {
  // Guard against path prefix attacks: /tmp/ctx vs /tmp/ctx-evil
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-prefix-'));
  const contextDir = path.join(base, 'context');
  const siblingDir = path.join(base, 'context-evil');
  fs.mkdirSync(contextDir);
  fs.mkdirSync(siblingDir);
  try {
    const evilPath = path.join(siblingDir, 'sneaky.md');
    const result = await embedSingleFile(evilPath, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'outside_context_dir');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns not_a_markdown_file for .txt file', async () => {
  const contextDir = makeTempContextDir();
  try {
    const txtFile = path.join(contextDir, 'notes.txt');
    // File doesn't need to exist — the extension check is before existsSync
    const result = await embedSingleFile(txtFile, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'not_a_markdown_file');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns not_a_markdown_file for .json file', async () => {
  const contextDir = makeTempContextDir();
  try {
    const jsonFile = path.join(contextDir, 'config.json');
    const result = await embedSingleFile(jsonFile, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'not_a_markdown_file');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns not_a_markdown_file for extensionless file', async () => {
  const contextDir = makeTempContextDir();
  try {
    const noExt = path.join(contextDir, 'Makefile');
    const result = await embedSingleFile(noExt, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'not_a_markdown_file');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns index_or_readme for CONTEXT.md', async () => {
  const contextDir = makeTempContextDir();
  try {
    const contextMd = path.join(contextDir, 'CONTEXT.md');
    fs.writeFileSync(contextMd, '# Index\n');
    const result = await embedSingleFile(contextMd, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'index_or_readme');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns index_or_readme for README.md', async () => {
  const contextDir = makeTempContextDir();
  try {
    const readme = path.join(contextDir, 'README.md');
    fs.writeFileSync(readme, '# Readme\n');
    const result = await embedSingleFile(readme, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'index_or_readme');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: returns index_or_readme for nested CONTEXT.md', async () => {
  const contextDir = makeTempContextDir();
  const sub = path.join(contextDir, 'patterns');
  fs.mkdirSync(sub);
  try {
    const contextMd = path.join(sub, 'CONTEXT.md');
    fs.writeFileSync(contextMd, '# Patterns index\n');
    const result = await embedSingleFile(contextMd, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'index_or_readme');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});

test('embedSingleFile: normalizes paths (trailing slash, relative segments)', async () => {
  const contextDir = makeTempContextDir();
  try {
    // Use /../ to create a path that resolves outside
    const escapePath = path.join(contextDir, '..', 'escape.md');
    const result = await embedSingleFile(escapePath, contextDir);
    assert.equal(result.embedded, false);
    assert.equal(result.reason, 'outside_context_dir');
  } finally {
    fs.rmSync(contextDir, { recursive: true, force: true });
  }
});
