/**
 * Per-project config (3-tier merge) tests — global plugin.json → machine-local
 * ~/.contextus/data/<project>/config.json → git-committed <cwd>/.claude/contextus.json,
 * later tiers winning. The multi-project unblocker: each project calibrates its own
 * floor without touching the others (the global-config bug, 2026-06-15).
 *
 * These touch the real machine-local path (projectLocalConfigPath) under a uniquely
 * named throwaway project, and a temp cwd for tier 3 — cleaned up after.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadConfig,
  loadProjectConfig,
  projectLocalConfigPath,
  resetConfigCache
} from '../lib/config.js';

const PROJ = 'test-proj-cfg-zzz'; // unique, unlikely to collide with a real corpus

function cleanup(): void {
  const p = projectLocalConfigPath(PROJ);
  if (fs.existsSync(p)) fs.rmSync(path.dirname(p), { recursive: true, force: true });
  resetConfigCache();
}

test('loadProjectConfig: no overrides → equals global config', () => {
  cleanup();
  try {
    assert.equal(
      loadProjectConfig(PROJ).retrieval.injectionFloor,
      loadConfig().retrieval.injectionFloor
    );
  } finally {
    cleanup();
  }
});

test('loadProjectConfig: machine-local (tier 2) overrides global', () => {
  cleanup();
  try {
    const p = projectLocalConfigPath(PROJ);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ config: { retrieval: { injectionFloor: 0.4 } } }));
    resetConfigCache();
    assert.equal(loadProjectConfig(PROJ).retrieval.injectionFloor, 0.4);
    // a DIFFERENT project is unaffected (isolation)
    assert.equal(
      loadProjectConfig('some-other-proj').retrieval.injectionFloor,
      loadConfig().retrieval.injectionFloor
    );
  } finally {
    cleanup();
  }
});

test('loadProjectConfig: git-committed (tier 3) WINS over machine-local', () => {
  cleanup();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cwd-'));
  try {
    // tier 2 says 0.40
    const p = projectLocalConfigPath(PROJ);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ config: { retrieval: { injectionFloor: 0.4 } } }));
    // tier 3 (repo) says 0.55 — should win
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'contextus.json'),
      JSON.stringify({ config: { retrieval: { injectionFloor: 0.55 } } })
    );
    resetConfigCache();
    assert.equal(loadProjectConfig(PROJ, cwd).retrieval.injectionFloor, 0.55);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    cleanup();
  }
});

test('loadProjectConfig: flat override (no `config` wrapper) also accepted', () => {
  cleanup();
  try {
    const p = projectLocalConfigPath(PROJ);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    // flat shape — readConfigFile falls back to the whole object
    fs.writeFileSync(p, JSON.stringify({ retrieval: { injectionFloor: 0.42 } }));
    resetConfigCache();
    assert.equal(loadProjectConfig(PROJ).retrieval.injectionFloor, 0.42);
  } finally {
    cleanup();
  }
});

test('loadProjectConfig: empty project → falls back to global', () => {
  assert.equal(loadProjectConfig(undefined), loadConfig());
});

test('project tiers reject embedding space overrides while accepting other embedding settings', () => {
  cleanup();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-embedding-cfg-'));
  const local = projectLocalConfigPath(PROJ);
  const repo = path.join(cwd, '.claude', 'contextus.json');
  try {
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.mkdirSync(path.dirname(repo), { recursive: true });
    for (const key of ['provider', 'model', 'ollamaModel', 'dimensions']) {
      fs.writeFileSync(local, JSON.stringify({ embedding: { [key]: 'invalid' } }));
      resetConfigCache();
      assert.throws(
        () => loadProjectConfig(PROJ, cwd),
        new RegExp(`cannot override embedding settings: ${key}`)
      );
      fs.writeFileSync(local, '{}');
      fs.writeFileSync(repo, JSON.stringify({ embedding: { [key]: 'invalid' } }));
      resetConfigCache();
      assert.throws(
        () => loadProjectConfig(PROJ, cwd),
        new RegExp(`cannot override embedding settings: ${key}`)
      );
      fs.writeFileSync(repo, '{}');
    }
    fs.writeFileSync(
      repo,
      JSON.stringify({ embedding: { batchSize: 3, transformers: { allowRemoteModels: false } } })
    );
    resetConfigCache();
    assert.equal(loadProjectConfig(PROJ, cwd).embedding.batchSize, 3);
    assert.equal(loadProjectConfig(PROJ, cwd).embedding.transformers?.allowRemoteModels, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    cleanup();
  }
});

test('transcriptMining: defaults to disabled (opt-in only, GH issue #39)', () => {
  cleanup();
  try {
    const cfg = loadProjectConfig(PROJ);
    assert.equal(cfg.transcriptMining.enabled, false);
    assert.equal(cfg.transcriptMining.intervalHours, 24);
  } finally {
    cleanup();
  }
});

test('transcriptMining: project-level override enables it and sets a custom interval', () => {
  cleanup();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-cwd-'));
  try {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'contextus.json'),
      JSON.stringify({ config: { transcriptMining: { enabled: true, intervalHours: 6 } } })
    );
    resetConfigCache();
    const cfg = loadProjectConfig(PROJ, cwd);
    assert.equal(cfg.transcriptMining.enabled, true);
    assert.equal(cfg.transcriptMining.intervalHours, 6);
    // A DIFFERENT project (no override) stays at the default — isolation.
    assert.equal(loadProjectConfig('some-other-proj').transcriptMining.enabled, false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    cleanup();
  }
});
