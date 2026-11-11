import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

function runNode(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, windowsHide: true });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.stderr.on('data', (chunk: string) => (output += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Child exited with ${code}:\n${output}`));
    });
  });
}

test('shared sources use shared embedding settings and the shared row scope', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-shared-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-project-'));
  const oldHome = process.env.HOME;
  const oldFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  process.env.HOME = home;
  process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
  const { resetConfigCache, loadConfig } = await import('../../lib/config.js');
  const { runReconcile } = await import('../../lib/embedding/reconcile-run.js');
  const { getContentHashes, readTableMeta, resetConnection } =
    await import('../../lib/storage/lance-client.js');
  try {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.claude', 'contextus.jsonc'),
      JSON.stringify({ retrieval: { topK: 3 } })
    );
    const docs = path.join(home, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'guide.md'), '# Shared guide\ncontent');
    resetConfigCache();
    const dimensions = loadConfig().embedding.dimensions;
    const result = await runReconcile(
      docs,
      undefined,
      '',
      'customShared',
      undefined,
      'doc',
      project,
      'user'
    );
    assert.equal(result.embedded, 1);
    assert.equal(readTableMeta()?.dimensions, dimensions);
    assert.equal(
      (await getContentHashes(undefined, 'customShared', '__user__')).has('guide.md'),
      true
    );
    assert.equal(
      (await getContentHashes(undefined, 'customShared', 'another-project')).has('guide.md'),
      false
    );
    const { embedSingleFile } = await import('../../lib/embedding/embed-file.js');
    fs.writeFileSync(path.join(docs, 'guide.md'), '# Shared guide\nupdated');
    const updated = await embedSingleFile(
      path.join(docs, 'guide.md'),
      docs,
      undefined,
      'customShared',
      '',
      'doc',
      project,
      'user'
    );
    assert.equal(updated.embedded, true);
    assert.equal(
      (await getContentHashes(undefined, 'customShared', '__user__')).has('guide.md'),
      true
    );
    const repeated = await runReconcile(
      docs,
      undefined,
      '',
      'customShared',
      undefined,
      'doc',
      project,
      'user'
    );
    assert.equal(repeated.state, 'fresh');
    fs.unlinkSync(path.join(docs, 'guide.md'));
    const removed = await embedSingleFile(
      path.join(docs, 'guide.md'),
      docs,
      undefined,
      'customShared',
      '',
      'doc',
      project,
      'user'
    );
    assert.equal(removed.reason, 'deleted');
    assert.equal(
      (await getContentHashes(undefined, 'customShared', '__user__')).has('guide.md'),
      false
    );
  } finally {
    resetConnection();
    resetConfigCache();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = oldFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('shared source reconcile rejects incompatible project embedding settings before writing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-shared-config-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-project-config-'));
  const oldHome = process.env.HOME;
  const oldFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  process.env.HOME = home;
  process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
  const { resetConfigCache } = await import('../../lib/config.js');
  const { runReconcile } = await import('../../lib/embedding/reconcile-run.js');
  const { resetConnection, tableExists } = await import('../../lib/storage/lance-client.js');
  try {
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.claude', 'contextus.jsonc'),
      JSON.stringify({ embedding: { dimensions: 7 } })
    );
    const docs = path.join(home, 'docs');
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'guide.md'), '# Shared guide\ncontent');
    resetConfigCache();

    await assert.rejects(
      runReconcile(docs, undefined, '', 'userDocs', undefined, 'doc', project),
      /cannot override embedding settings: dimensions/
    );
    assert.equal(await tableExists(), false);
  } finally {
    resetConnection();
    resetConfigCache();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = oldFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('full rebuild stores a custom user-scoped source under the shared project', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-rebuild-shared-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-rebuild-shared-project-'));
  const docs = path.join(home, 'shared-docs');
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const { resetConfigCache } = await import('../../lib/config.js');
  const { getContentHashes, resetConnection } = await import('../../lib/storage/lance-client.js');
  try {
    fs.mkdirSync(docs);
    fs.writeFileSync(path.join(docs, 'guide.md'), '# Shared guide\ncontent');
    fs.mkdirSync(path.join(project, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.claude', 'contextus.jsonc'),
      JSON.stringify({
        sources: {
          projectMemory: { enabled: false },
          projectContext: { enabled: false },
          projectDocs: { enabled: false },
          userMemory: { enabled: false },
          userContext: { enabled: false },
          userDocs: { enabled: false },
          customShared: { enabled: true, scope: 'user', type: 'doc', path: docs }
        }
      })
    );
    const script = path.join(process.cwd(), 'scripts', 'embed-contexts.ts');
    await runNode(['--import', import.meta.resolve('tsx'), script], project, {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CONTEXTUS_TEST_FAKE_EMBED: '1'
    });
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    resetConfigCache();
    assert.equal(
      (await getContentHashes(undefined, 'customShared', '__user__')).has('guide.md'),
      true
    );
    assert.equal((await getContentHashes(undefined, 'customShared', 'another-project')).size, 0);
  } finally {
    resetConnection();
    resetConfigCache();
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldProfile;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('cold-start reconcile rejects mismatched provider vectors before creating the table', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-reconcile-dim-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-project-dim-'));
  const oldHome = process.env.HOME;
  const oldFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  const oldFetch = globalThis.fetch;
  const oldPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.HOME = home;
  process.env.CLAUDE_PLUGIN_ROOT = home;
  delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ embedding: Array.from({ length: 768 }, () => 1) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  const { resetConfigCache, projectHash } = await import('../../lib/config.js');
  const { runReconcile } = await import('../../lib/embedding/reconcile-run.js');
  const { resetConnection, tableExists } = await import('../../lib/storage/lance-client.js');
  try {
    const contextDir = path.join(project, '.claude', 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'plugin.json'),
      JSON.stringify({ config: { embedding: { provider: 'ollama', dimensions: 7 } } })
    );
    fs.writeFileSync(
      path.join(contextDir, 'decision-test.md'),
      '---\nname: test\ndescription: test context\nmetadata:\n  type: decision\n---\ncontent'
    );
    resetConfigCache();

    await assert.rejects(
      runReconcile(
        contextDir,
        'dimension-test',
        projectHash(project),
        'projectContext',
        undefined,
        undefined,
        project
      ),
      /768; expected 7/
    );
    assert.equal(await tableExists('dimension-test'), false);
  } finally {
    resetConnection();
    resetConfigCache();
    globalThis.fetch = oldFetch;
    if (oldPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = oldPluginRoot;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = oldFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('incremental embedding rejects mismatched provider vectors before creating the table', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-incremental-dim-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-incremental-dim-project-'));
  const oldHome = process.env.HOME;
  const oldUserProfile = process.env.USERPROFILE;
  const oldFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  const oldFetch = globalThis.fetch;
  const oldPluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CLAUDE_PLUGIN_ROOT = home;
  delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ embedding: Array.from({ length: 768 }, () => 1) }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  const { resetConfigCache, projectHash } = await import('../../lib/config.js');
  const { embedSingleFile } = await import('../../lib/embedding/embed-file.js');
  const { resetConnection, tableExists } = await import('../../lib/storage/lance-client.js');
  try {
    const contextDir = path.join(project, '.claude', 'context');
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'plugin.json'),
      JSON.stringify({ config: { embedding: { provider: 'ollama', dimensions: 7 } } })
    );
    const file = path.join(contextDir, 'decision-test.md');
    fs.writeFileSync(
      file,
      '---\nname: test\ndescription: test context\nmetadata:\n  type: decision\n---\ncontent'
    );
    resetConfigCache();

    await assert.rejects(
      embedSingleFile(
        file,
        contextDir,
        'incremental-dimension-test',
        'projectContext',
        projectHash(project),
        'context',
        project
      ),
      /768; expected 7/
    );
    assert.equal(await tableExists('incremental-dimension-test'), false);
  } finally {
    resetConnection();
    resetConfigCache();
    globalThis.fetch = oldFetch;
    if (oldPluginRoot === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
    else process.env.CLAUDE_PLUGIN_ROOT = oldPluginRoot;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    if (oldUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = oldUserProfile;
    if (oldFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = oldFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});

test('full rebuild rejects mismatched provider vectors before creating the table', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-full-embed-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-full-embed-project-'));
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ embedding: Array.from({ length: 768 }, () => 1) }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const contextDir = path.join(project, '.claude', 'context');
  const configPath = path.join(project, '.claude', 'contextus.jsonc');
  try {
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(
      path.join(home, 'plugin.json'),
      JSON.stringify({ config: { embedding: { provider: 'ollama', dimensions: 7 } } })
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        providers: { ollama: { endpoint: `http://127.0.0.1:${address.port}` } },
        sources: {
          projectContext: { enabled: true, path: contextDir },
          projectMemory: { enabled: false },
          projectDocs: { enabled: false },
          userMemory: { enabled: false },
          userContext: { enabled: false },
          userDocs: { enabled: false }
        }
      })
    );
    fs.writeFileSync(
      path.join(contextDir, 'decision-test.md'),
      '---\nname: test\ndescription: test context\nmetadata:\n  type: decision\n---\ncontent'
    );

    const repoRoot = process.cwd();
    const script = path.join(repoRoot, 'scripts', 'embed-contexts.ts');
    const output = await runNode(['--import', import.meta.resolve('tsx'), script], project, {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_PLUGIN_ROOT: home,
      CONTEXTUS_TEST_FAKE_EMBED: undefined
    }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));

    assert.match(output, /unexpected dimensions \(768; expected 7\)/);
    assert.equal(fs.existsSync(path.join(home, '.contextus', 'data')), false);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  }
});
