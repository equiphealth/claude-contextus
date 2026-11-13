import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

test('capture stores project documents and contexts under the cwd hash', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-capture-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-capture-project-'));
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  const previousFake = process.env.CONTEXTUS_TEST_FAKE_EMBED;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CONTEXTUS_TEST_FAKE_EMBED = '1';
  const { requestHandler, determineSource } = await import('../../daemon/server.js');
  const { projectHash, resetConfigCache } = await import('../../lib/config.js');
  const { resolveSources } = await import('../../lib/embedding/sources.js');
  const { getContentHashes, resetConnection } = await import('../../lib/storage/lance-client.js');
  const server = http.createServer(requestHandler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const customDir = path.join(cwd, '.claude', 'custom');
    fs.mkdirSync(customDir, { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'contextus.json'),
      JSON.stringify({ sources: { custom: { path: '.claude/custom', type: 'doc' } } })
    );
    assert.equal(
      determineSource(path.join(customDir, 'test.md'), cwd, undefined)?.scope,
      'project'
    );
    assert.equal(resolveSources({ custom: { path: customDir } })[0].scope, 'project');
    const id = projectHash(cwd);
    for (const [body, source, filename] of [
      [
        { target: 'doc', slug: 'capture-doc', body: 'document body' },
        'projectDocs',
        'capture-doc.md'
      ],
      [
        {
          target: 'context',
          category: 'decision',
          slug: 'capture-context',
          description: 'test',
          body: 'context body'
        },
        'projectContext',
        path.join('decisions', 'decision-capture-context.md')
      ]
    ] as const) {
      const response = await fetch(`http://127.0.0.1:${port}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, cwd, project: 'unregistered-friendly-name' })
      });
      assert.equal(response.status, 200);
      const deadline = Date.now() + 10000;
      let hashes = new Map<string, string>();
      while (Date.now() < deadline) {
        hashes = await getContentHashes(undefined, source, id);
        if (hashes.has(filename)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(hashes.has(filename), `${source}: ${[...hashes.keys()].join(', ')}`);
    }
    assert.equal(
      (await getContentHashes(undefined, undefined, 'unregistered-friendly-name')).size,
      0
    );

    const userResponse = await fetch(`http://127.0.0.1:${port}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        target: 'doc',
        slug: 'capture-user-doc',
        body: 'shared document body',
        scope: 'user',
        cwd,
        project: 'unregistered-friendly-name'
      })
    });
    assert.equal(userResponse.status, 200);
    const userDeadline = Date.now() + 10000;
    let userHashes = new Map<string, string>();
    while (Date.now() < userDeadline) {
      userHashes = await getContentHashes(undefined, 'userDocs', '__user__');
      if (userHashes.has('capture-user-doc.md')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(userHashes.has('capture-user-doc.md'));
    assert.equal((await getContentHashes(undefined, 'userDocs', id)).size, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    resetConnection();
    resetConfigCache();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    if (previousFake === undefined) delete process.env.CONTEXTUS_TEST_FAKE_EMBED;
    else process.env.CONTEXTUS_TEST_FAKE_EMBED = previousFake;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
