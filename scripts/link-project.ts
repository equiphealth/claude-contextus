#!/usr/bin/env node
/**
 * link-project — Add another project's context to your corpus.
 *
 * Usage:
 *   pnpm link-project <path>              # link by path (name derived from basename)
 *   pnpm link-project <path> --name foo   # explicit name
 *   pnpm link-project --list              # show current links
 *   pnpm link-project --remove <name>     # unlink a project
 *   pnpm link-project --help
 */

import fs from 'fs';
import path from 'path';
import { projectLocalConfigPath } from '../lib/config.js';

interface LinkedProjectEntry {
  name: string;
  path: string;
  enabled: boolean;
}

const USAGE = `link-project — share context across projects

Usage:
  pnpm link-project <path>              Link a project's .claude/context/
  pnpm link-project <path> --name foo   Link with explicit name
  pnpm link-project --list              Show linked projects
  pnpm link-project --remove <name>     Unlink a project
  pnpm link-project --help              Show this help

The linked project's .claude/context/ patterns become searchable in
your current project's corpus, ranked just below your own context.
Changes in the linked project refresh automatically (macOS/Win).`;

function currentProject(): string {
  return path.basename(process.cwd());
}

function readConfig(configPath: string): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(configPath: string, config: Record<string, unknown>): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function getLinked(config: Record<string, unknown>): LinkedProjectEntry[] {
  return Array.isArray(config.linkedProjects) ? config.linkedProjects : [];
}

async function triggerReconcile(project: string): Promise<void> {
  try {
    const res = await fetch('http://127.0.0.1:37800/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, cwd: process.cwd() }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) console.log('  Triggered re-embed (daemon will process in background)');
  } catch {
    console.log('  Daemon not running — linked context will embed on next session start');
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const project = currentProject();
  const configPath = projectLocalConfigPath(project);
  const config = readConfig(configPath);

  // --list
  if (argv.includes('--list')) {
    const linked = getLinked(config);
    if (linked.length === 0) {
      console.log('No linked projects.');
    } else {
      console.log(`Linked projects (${project}):\n`);
      for (const entry of linked) {
        const status = entry.enabled !== false ? '✓' : '✗';
        const contextDir = path.join(entry.path, '.claude', 'context');
        const exists = fs.existsSync(contextDir);
        console.log(`  ${status} ${entry.name} → ${entry.path}${exists ? '' : ' (missing!)'}`);
      }
    }
    process.exit(0);
  }

  // --remove <name>
  const removeIdx = argv.indexOf('--remove');
  if (removeIdx !== -1) {
    const name = argv[removeIdx + 1];
    if (!name) {
      console.error('Error: --remove requires a project name');
      process.exit(1);
    }
    const linked = getLinked(config);
    const filtered = linked.filter((e) => e.name !== name);
    if (filtered.length === linked.length) {
      console.error(`Error: no linked project named "${name}"`);
      console.log('Run: pnpm link-project --list');
      process.exit(1);
    }
    config.linkedProjects = filtered;
    writeConfig(configPath, config);
    console.log(`Unlinked "${name}".`);

    // Ask daemon to purge orphan rows immediately
    try {
      const res = await fetch('http://127.0.0.1:37800/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project, cwd: process.cwd() }),
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) console.log('  Orphan rows will be cleaned in background.');
    } catch {
      console.log('  Daemon not running — orphan rows will be cleaned on next session start.');
    }
    process.exit(0);
  }

  // link <path> [--name <name>]
  const targetPathRaw = argv.find((a) => !a.startsWith('--'));
  if (!targetPathRaw) {
    console.error('Error: provide the path to the project to link');
    process.exit(1);
  }
  const targetPath = path.resolve(targetPathRaw.replace(/^~/, process.env.HOME || '~'));
  const contextDir = path.join(targetPath, '.claude', 'context');

  if (!fs.existsSync(targetPath)) {
    console.error(`Error: path does not exist: ${targetPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(contextDir)) {
    console.error(`Error: no .claude/context/ found at ${targetPath}`);
    console.error('The target project needs a context directory to link.');
    process.exit(1);
  }

  const nameIdx = argv.indexOf('--name');
  const name = nameIdx !== -1 && argv[nameIdx + 1] ? argv[nameIdx + 1] : path.basename(targetPath);

  const linked = getLinked(config);
  const existing = linked.find((e) => e.name === name);
  if (existing) {
    console.log(`"${name}" already linked → ${existing.path}`);
    if (existing.path !== targetPath) {
      existing.path = targetPath;
      writeConfig(configPath, config);
      console.log(`  Updated path to ${targetPath}`);
    }
    process.exit(0);
  }

  linked.push({ name, path: targetPath, enabled: true });
  config.linkedProjects = linked;
  writeConfig(configPath, config);

  const mdCount = fs
    .readdirSync(contextDir, { recursive: true })
    .filter((f) => String(f).endsWith('.md')).length;

  console.log(`Linked "${name}" (${mdCount} context files)`);
  console.log(`  Source: ${contextDir}`);
  console.log(`  Config: ${configPath}`);

  await triggerReconcile(project);
}

main();
