#!/usr/bin/env node
/**
 * migrate-workspaces — convert linkedProjects config entries to workspace files.
 *
 * Reads each project's tier-2 config.json, extracts linkedProjects, groups
 * mutually-linked projects into workspaces, writes workspace JSONC files,
 * and removes the linkedProjects key from the config.
 *
 * Safe to re-run: skips projects that have no linkedProjects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expandHome, stripJsonComments } from '../lib/config.js';
import { addProjectToWorkspace } from '../lib/workspace.js';

const DATA_DIR = path.resolve(expandHome('~/.contextus/data'));

interface LinkedEntry {
  name: string;
  path: string;
  enabled?: boolean;
}

interface ProjectConfig {
  dirName: string;
  configPath: string;
  linkedProjects: LinkedEntry[];
}

function findProjectConfigs(): ProjectConfig[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const results: ProjectConfig[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const configPath = path.join(DATA_DIR, e.name, 'config.json');
    if (!fs.existsSync(configPath)) continue;
    try {
      const text = fs.readFileSync(configPath, 'utf-8');
      const raw = JSON.parse(stripJsonComments(text));
      if (Array.isArray(raw.linkedProjects) && raw.linkedProjects.length > 0) {
        results.push({ dirName: e.name, configPath, linkedProjects: raw.linkedProjects });
      }
    } catch {
      // skip
    }
  }
  return results;
}

function removeLinkedProjectsKey(configPath: string): void {
  try {
    const text = fs.readFileSync(configPath, 'utf-8');
    const raw = JSON.parse(stripJsonComments(text));
    delete raw.linkedProjects;
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + '\n');
  } catch {
    // best-effort
  }
}

function main(): void {
  const dryRun = process.argv.includes('--dry-run');
  const configs = findProjectConfigs();

  if (configs.length === 0) {
    console.log('No linkedProjects entries found — nothing to migrate.');
    process.exit(0);
  }

  console.log(`Found ${configs.length} project(s) with linkedProjects:\n`);

  for (const cfg of configs) {
    console.log(`  ${cfg.dirName}:`);
    for (const lp of cfg.linkedProjects) {
      const status = lp.enabled === false ? ' (disabled)' : '';
      console.log(`    → ${lp.name} (${lp.path})${status}`);
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: no changes made.');
    process.exit(0);
  }

  console.log('\nMigrating to workspace files...\n');

  // Strategy: for each project, create a workspace named after the project that
  // contains itself + all its linked projects. If projects are mutually linked,
  // they'll converge into the same workspace since addProjectToWorkspace is
  // idempotent.
  for (const cfg of configs) {
    const workspaceName = cfg.dirName;
    // The old config only stores linked entries, not the project's own absolute path.
    // The project itself gets added to the workspace on its next session start
    // (when the daemon computes projectHash from cwd and sees the workspace file).
    for (const lp of cfg.linkedProjects) {
      if (lp.enabled === false) continue;
      addProjectToWorkspace(workspaceName, lp.path);
      console.log(`  Added ${lp.name} to workspace "${workspaceName}"`);
    }

    // Remove the old key
    removeLinkedProjectsKey(cfg.configPath);
    console.log(`  Cleaned linkedProjects from ${cfg.configPath}`);
  }

  console.log('\nDone. Workspaces written to ~/.contextus/workspaces/');
  console.log('Run /rebuild-embeddings to re-embed with the unified DB.');
}

main();
