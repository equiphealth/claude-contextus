#!/usr/bin/env tsx
/**
 * Pre-merge release checks — verifies version lockstep, lint, prettier, and types.
 * Run before merging a release PR:
 *   pnpm check-release
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { stripJsonComments } from '../lib/config.js';

const ROOT = path.resolve(import.meta.dirname, '..');

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function check(name: string, fn: () => string | true) {
  try {
    const result = fn();
    if (result === true) {
      results.push({ name, pass: true });
    } else {
      results.push({ name, pass: false, detail: result });
    }
  } catch (err) {
    results.push({ name, pass: false, detail: String(err) });
  }
}

function readJson(relPath: string): Record<string, unknown> {
  const full = path.join(ROOT, relPath);
  const raw = fs.readFileSync(full, 'utf8');
  const cleaned = stripJsonComments(raw);
  return JSON.parse(cleaned);
}

// 1. Version lockstep
check('Version lockstep (package.json ↔ plugin.jsonc ↔ .claude-plugin/plugin.json)', () => {
  const pkg = readJson('package.json') as { version: string };
  const plugin = readJson('plugin.jsonc') as { version: string };
  const manifest = readJson('.claude-plugin/plugin.json') as { version: string };

  const versions = {
    'package.json': pkg.version,
    'plugin.jsonc': plugin.version,
    '.claude-plugin/plugin.json': manifest.version
  };

  const unique = new Set(Object.values(versions));
  if (unique.size === 1) return true;

  const lines = Object.entries(versions).map(([f, v]) => `  ${f}: ${v}`);
  return `Version mismatch:\n${lines.join('\n')}`;
});

// 2. CHANGELOG has entry for current version
check('CHANGELOG.md has entry for current version', () => {
  const pkg = readJson('package.json') as { version: string };
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const heading = `## [${pkg.version}]`;
  if (changelog.includes(heading)) return true;
  return `Missing heading: "${heading}" in CHANGELOG.md`;
});

// 3. TypeScript
check('TypeScript (tsc --noEmit)', () => {
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (err: unknown) {
    const output = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    const lines = output.split('\n').filter((l) => l.includes('error'));
    return `${lines.length} type error(s):\n${lines.slice(0, 5).join('\n')}`;
  }
});

// 4. ESLint
check('ESLint', () => {
  try {
    execSync('pnpm lint', { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    return `Lint failed:\n${stderr.slice(0, 300)}`;
  }
});

// 5. Prettier
check('Prettier', () => {
  try {
    execSync('npx prettier --check .', { cwd: ROOT, stdio: 'pipe' });
    return true;
  } catch (err: unknown) {
    const stdout = (err as { stdout?: Buffer }).stdout?.toString() ?? '';
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    const combined = stdout + '\n' + stderr;
    const unformatted = combined
      .split('\n')
      .filter((l) => l.includes('[warn]') && !l.includes('Code style'))
      .slice(0, 5);
    if (unformatted.length === 0) return 'Prettier reported formatting issues (run: pnpm format)';
    return `Unformatted files:\n${unformatted.join('\n')}`;
  }
});

// 6. Tests
check('Tests (pnpm test)', () => {
  try {
    execSync('pnpm test', { cwd: ROOT, stdio: 'pipe', timeout: 30_000 });
    return true;
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? '';
    const failLines = stderr.split('\n').filter((l) => /not ok|fail|error/i.test(l));
    return `Tests failed:\n${failLines.slice(0, 5).join('\n')}`;
  }
});

// Report
console.log('\n  Release Checks\n  ' + '─'.repeat(50));
let allPass = true;
for (const r of results) {
  const icon = r.pass ? '✓' : '✗';
  console.log(`  ${icon} ${r.name}`);
  if (!r.pass && r.detail) {
    for (const line of r.detail.split('\n')) {
      console.log(`    ${line}`);
    }
    allPass = false;
  }
}
console.log('  ' + '─'.repeat(50));

if (allPass) {
  console.log('  All checks passed — ready to merge.\n');
} else {
  console.log('  Some checks failed — fix before merging.\n');
  process.exit(1);
}
