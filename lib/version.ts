/**
 * Version tracking — records what version the user's data has been migrated to.
 *
 * ~/.contextus/version.json tracks the "data schema version" — the last version
 * whose migrations were applied. This can lag behind the installed code version
 * if the user hasn't run /contextus-upgrade yet.
 *
 * On fresh install, the file doesn't exist (→ version '0.0.0' → all migrations run).
 * After a successful upgrade, it's stamped with the current package.json version.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandHome } from './config.js';

const VERSION_PATH = path.resolve(expandHome('~/.contextus/version.json'));

export interface VersionState {
  version: string;
  migratedAt: string;
}

export function readVersionState(): VersionState {
  try {
    const raw = JSON.parse(fs.readFileSync(VERSION_PATH, 'utf-8'));
    return { version: raw.version ?? '0.0.0', migratedAt: raw.migratedAt ?? '' };
  } catch {
    return { version: '0.0.0', migratedAt: '' };
  }
}

export function writeVersionState(version: string): void {
  const dir = path.dirname(VERSION_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const state: VersionState = { version, migratedAt: new Date().toISOString() };
  fs.writeFileSync(VERSION_PATH, JSON.stringify(state, null, 2) + '\n');
}

export function getInstalledVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'package.json'
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Compare semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/** True if the data version is behind the installed code version. */
export function needsUpgrade(): boolean {
  const data = readVersionState().version;
  const installed = getInstalledVersion();
  return compareSemver(data, installed) < 0;
}
