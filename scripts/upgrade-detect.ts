#!/usr/bin/env node
/**
 * upgrade-detect — report what migrations are needed for the current install.
 *
 * Compares ~/.contextus/version.json (data schema version) against the installed
 * package.json version, then checks for specific migration triggers.
 *
 * Outputs JSON for the upgrade skill to parse.
 */

import fs from 'fs';
import path from 'path';
import { expandHome, stripJsonComments } from '../lib/config.js';
import {
  readVersionState,
  getInstalledVersion,
  compareSemver,
  needsUpgrade
} from '../lib/version.js';

const DATA_DIR = path.resolve(expandHome('~/.contextus/data'));
const WORKSPACES_DIR = path.resolve(expandHome('~/.contextus/workspaces'));

interface MigrationNeeded {
  version: string;
  title: string;
  reason: string;
}

interface DetectionResult {
  dataVersion: string;
  installedVersion: string;
  needsUpgrade: boolean;
  migrations: MigrationNeeded[];
  details: {
    perProjectDbs: string[];
    linkedProjectConfigs: Array<{
      project: string;
      entries: Array<{ name: string; path: string }>;
    }>;
    workspacesExist: boolean;
    unifiedDbExists: boolean;
  };
}

function findPerProjectDbs(): string[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const dirs: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === 'contextus.lance') continue;
    const lanceDir = path.join(DATA_DIR, e.name, 'contextus.lance');
    if (fs.existsSync(lanceDir)) {
      dirs.push(e.name);
    }
  }
  return dirs;
}

function findLinkedProjectConfigs(): DetectionResult['details']['linkedProjectConfigs'] {
  if (!fs.existsSync(DATA_DIR)) return [];
  const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true });
  const results: DetectionResult['details']['linkedProjectConfigs'] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const configPath = path.join(DATA_DIR, e.name, 'config.json');
    if (!fs.existsSync(configPath)) continue;
    try {
      const text = fs.readFileSync(configPath, 'utf-8');
      const raw = JSON.parse(stripJsonComments(text));
      if (Array.isArray(raw.linkedProjects) && raw.linkedProjects.length > 0) {
        results.push({
          project: e.name,
          entries: raw.linkedProjects.map((lp: any) => ({ name: lp.name, path: lp.path }))
        });
      }
    } catch {
      // skip unparseable
    }
  }
  return results;
}

function detectMigrations(dataVersion: string, installedVersion: string): MigrationNeeded[] {
  const migrations: MigrationNeeded[] = [];

  // 0.8.0: Unified DB + Workspaces
  // Only propose if installed version is >= 0.8.0 (otherwise the code doesn't support it yet)
  if (compareSemver(dataVersion, '0.8.0') < 0 && compareSemver(installedVersion, '0.8.0') >= 0) {
    const perProjectDbs = findPerProjectDbs();
    const linkedConfigs = findLinkedProjectConfigs();
    if (perProjectDbs.length > 0 || linkedConfigs.length > 0) {
      migrations.push({
        version: '0.8.0',
        title: 'Unified Database & Workspaces',
        reason:
          perProjectDbs.length > 0
            ? `${perProjectDbs.length} per-project DB(s) need consolidation`
            : `${linkedConfigs.length} project(s) with linkedProjects → workspace conversion`
      });
    } else {
      // Even without old data, mark that re-embed is needed for project column
      migrations.push({
        version: '0.8.0',
        title: 'Unified Database & Workspaces',
        reason: 'Re-embed needed to add project column to rows'
      });
    }
  }

  // Future migrations go here:
  // if (compareSemver(dataVersion, '0.9.0') < 0) { ... }

  return migrations;
}

function main(): void {
  const dataVersion = readVersionState().version;
  const installedVersion = getInstalledVersion();
  const perProjectDbs = findPerProjectDbs();
  const linkedProjectConfigs = findLinkedProjectConfigs();
  const workspacesExist =
    fs.existsSync(WORKSPACES_DIR) &&
    fs.readdirSync(WORKSPACES_DIR).some((f) => f.endsWith('.jsonc') || f.endsWith('.json'));
  const unifiedDbExists = fs.existsSync(path.join(DATA_DIR, 'contextus.lance'));

  const result: DetectionResult = {
    dataVersion,
    installedVersion,
    needsUpgrade: needsUpgrade(),
    migrations: detectMigrations(dataVersion, installedVersion),
    details: {
      perProjectDbs,
      linkedProjectConfigs,
      workspacesExist,
      unifiedDbExists
    }
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
