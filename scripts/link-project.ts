#!/usr/bin/env node
/**
 * link-project — Add another project to your workspace for shared context.
 *
 * Usage:
 *   pnpm link-project <path>                     # link (auto-creates workspace)
 *   pnpm link-project <path> --workspace foo     # explicit workspace name
 *   pnpm link-project --list                     # show workspaces for this project
 *   pnpm link-project --remove <path>            # unlink a project from workspace
 *   pnpm link-project --help
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome, projectHash } from '../lib/config.js';
import {
  workspacesForProject,
  addProjectToWorkspace,
  removeProjectFromWorkspace
} from '../lib/workspace.js';

const USAGE = `link-project — share context across projects via workspaces

Usage:
  pnpm link-project <path>                     Link a project (creates workspace if needed)
  pnpm link-project <path> --workspace foo     Link to a named workspace
  pnpm link-project --list                     Show workspaces containing this project
  pnpm link-project --remove <path>            Remove a project from shared workspace
  pnpm link-project --help                     Show this help

Projects in the same workspace share context bidirectionally — all context
patterns from sibling projects are searchable, ranked slightly below your own.
No duplicate data: each project embeds once, queries span all siblings.`;

function currentProjectPath(): string {
  return process.cwd();
}

async function triggerReconcile(): Promise<void> {
  const project = projectHash(currentProjectPath());
  try {
    const res = await fetch('http://127.0.0.1:37800/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, cwd: currentProjectPath() }),
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) console.log('  Triggered re-embed (daemon will process in background)');
  } catch {
    console.log('  Daemon not running — context will merge on next session start');
  }
}

function deriveWorkspaceName(path1: string, path2: string): string {
  const base1 = path.basename(path1);
  const base2 = path.basename(path2);
  return `${base1}-${base2}`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    console.log(USAGE);
    process.exit(0);
  }

  const cwd = currentProjectPath();

  // --list
  if (argv.includes('--list')) {
    const workspaces = workspacesForProject(cwd);
    if (workspaces.length === 0) {
      console.log('Not in any workspace. Link a project to create one.');
    } else {
      console.log(`Workspaces for ${path.basename(cwd)}:\n`);
      for (const ws of workspaces) {
        console.log(`  ${ws.name}:`);
        for (const p of ws.projects) {
          const resolved = path.resolve(expandHome(p.path));
          const isSelf = resolved === cwd;
          const exists = fs.existsSync(resolved);
          const label = isSelf ? ' (this project)' : exists ? '' : ' (missing!)';
          console.log(`    ${path.basename(resolved)} → ${p.path}${label}`);
        }
      }
    }
    process.exit(0);
  }

  // --remove <path>
  const removeIdx = argv.indexOf('--remove');
  if (removeIdx !== -1) {
    const targetRaw = argv[removeIdx + 1];
    if (!targetRaw) {
      console.error('Error: --remove requires a project path');
      process.exit(1);
    }
    const targetPath = path.resolve(targetRaw.replace(/^~/, process.env.HOME || '~'));
    const workspaces = workspacesForProject(cwd);
    let removed = false;
    for (const ws of workspaces) {
      if (removeProjectFromWorkspace(ws.name, targetPath)) {
        console.log(`Removed "${path.basename(targetPath)}" from workspace "${ws.name}".`);
        removed = true;
      }
    }
    if (!removed) {
      console.error(
        `Error: "${path.basename(targetPath)}" not found in any workspace with this project`
      );
      process.exit(1);
    }
    process.exit(0);
  }

  // link <path> [--workspace <name>]
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

  // Determine workspace name
  const wsIdx = argv.indexOf('--workspace');
  let workspaceName: string;
  if (wsIdx !== -1 && argv[wsIdx + 1]) {
    workspaceName = argv[wsIdx + 1];
  } else {
    // Use existing workspace if this project is already in one, else derive a name
    const existing = workspacesForProject(cwd);
    if (existing.length > 0) {
      workspaceName = existing[0].name;
    } else {
      workspaceName = deriveWorkspaceName(cwd, targetPath);
    }
  }

  // Add both projects to the workspace (self + target)
  addProjectToWorkspace(workspaceName, cwd);
  const ws = addProjectToWorkspace(workspaceName, targetPath);

  const mdCount = fs
    .readdirSync(contextDir, { recursive: true })
    .filter((f) => String(f).endsWith('.md')).length;

  console.log(`Linked "${path.basename(targetPath)}" (${mdCount} context files)`);
  console.log(`  Workspace: ${workspaceName}`);
  console.log(
    `  Members: ${ws.projects.map((p) => path.basename(path.resolve(expandHome(p.path)))).join(', ')}`
  );

  await triggerReconcile();
}

main();
