/**
 * CONTEXTUS_DEV is pinned, never auto-detected (must-fix work order Fix 2).
 *
 * The installed plugin ships a tracked tsconfig.json, so detecting dev mode
 * from its presence made every clean install behave as dev — skipping the
 * neutral dist straight into a network fetch at hook time. Unset must mean
 * production even when tsconfig.json is sitting right there (this repo
 * checkout is the fixture that proves it).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDevMode } from '../scripts/lib/daemon-control.js';

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function withEnv(value: string | undefined, fn: () => void): void {
  const prev = process.env.CONTEXTUS_DEV;
  try {
    if (value === undefined) delete process.env.CONTEXTUS_DEV;
    else process.env.CONTEXTUS_DEV = value;
    fn();
  } finally {
    if (prev === undefined) delete process.env.CONTEXTUS_DEV;
    else process.env.CONTEXTUS_DEV = prev;
  }
}

test('isDevMode follows only the CONTEXTUS_DEV flag (unset/0/false → production)', () => {
  // Precondition proving the pin: a tracked tsconfig.json exists, and the
  // old auto-detect would have read it as dev.
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, 'tsconfig.json')),
    'precondition: repo ships tsconfig.json'
  );
  withEnv(undefined, () => assert.equal(isDevMode(), false));
  withEnv('0', () => assert.equal(isDevMode(), false));
  withEnv('false', () => assert.equal(isDevMode(), false));
});

test('isDevMode honors explicit dev opt-in (1/true)', () => {
  withEnv('1', () => assert.equal(isDevMode(), true));
  withEnv('true', () => assert.equal(isDevMode(), true));
});
