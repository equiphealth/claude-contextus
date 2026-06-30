#!/usr/bin/env node
/**
 * setup-detect — Gather all setup state in one shot for the wizard skill.
 *
 * Outputs JSON so Claude can read project state without 8 separate bash calls.
 * Used by the /contextus-setup skill before presenting questions.
 *
 * Usage:
 *   pnpm setup-detect                  # detect from cwd
 *   pnpm setup-detect --dir <path>     # detect from specific project root
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { commandExists, detectPlatform, hasHomebrew, type Platform } from './install-ollama.js';

const HOME = os.homedir();
const CONTEXTUS_DATA = path.join(HOME, '.contextus', 'data');
const PROJECTS_JSON = path.join(CONTEXTUS_DATA, 'projects.json');
const USAGE_LOG = path.join(HOME, '.contextus', 'logs', 'usage.jsonl');
const STANZA_MARKER = '<!-- contextus:start -->';

type OllamaState =
  | { status: 'installed-running' } // binary exists + service reachable
  | { status: 'installed-stopped' } // binary exists + service down
  | { status: 'not-installed' } // binary not found
  | { status: 'unreachable' }; // network issue / unusual port

interface DetectionResult {
  ollamaReachable: boolean;
  ollamaState: OllamaState;
  platform: Platform;
  hasHomebrew: boolean;
  hasStanza: boolean;
  hasProjectConfig: boolean;
  hasPopulatedContext: boolean;
  legacyMemory: { count: number; path: string } | null;
  projectDocs: { count: number; path: string } | null;
  userMemory: { count: number; path: string } | null;
  userContext: { exists: boolean; path: string };
  existingProjects: string[];
  corpusState: 'missing' | 'empty' | 'populated';
  usageLogEntries: number;
  embeddingProvider: string;
  currentConfig: Record<string, unknown> | null;
}

function parseArgs(): string {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) return path.resolve(argv[++i]);
    if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('setup-detect — gather project state for the setup wizard\n');
      console.log('Usage: pnpm setup-detect [--dir <path>]');
      process.exit(0);
    }
  }
  return process.cwd();
}

function countMdFiles(dir: string): number {
  const SKIP = new Set(['CONTEXT.md', 'README.md', 'MEMORY.md', 'DOCS.md']);
  let count = 0;
  const stack = [dir];
  try {
    while (stack.length) {
      const cur = stack.pop()!;
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        if (ent.isDirectory()) stack.push(path.join(cur, ent.name));
        else if (ent.name.endsWith('.md') && !SKIP.has(ent.name)) count++;
      }
    }
  } catch {
    return 0;
  }
  return count;
}

function hasStanza(cwd: string): boolean {
  try {
    return fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8').includes(STANZA_MARKER);
  } catch {
    return false;
  }
}

function hasProjectConfig(cwd: string): boolean {
  return (
    fs.existsSync(path.join(cwd, '.claude', 'contextus.jsonc')) ||
    fs.existsSync(path.join(cwd, '.claude', 'contextus.json'))
  );
}

function detectLegacyMemory(cwd: string): { count: number; path: string } | null {
  const dir = path.join(cwd, '.claude', 'memory');
  const count = countMdFiles(dir);
  return count > 0 ? { count, path: '.claude/memory' } : null;
}

function detectProjectDocs(cwd: string): { count: number; path: string } | null {
  const dir = path.join(cwd, 'docs');
  const count = countMdFiles(dir);
  return count > 0 ? { count, path: 'docs' } : null;
}

function detectUserMemory(): { count: number; path: string } | null {
  const dir = path.join(HOME, '.claude', 'memory');
  const count = countMdFiles(dir);
  return count > 0 ? { count, path: '~/.claude/memory' } : null;
}

function detectUserContext(): { exists: boolean; path: string } {
  const dir = path.join(HOME, '.contextus', 'context');
  return { exists: fs.existsSync(dir) && countMdFiles(dir) > 0, path: '~/.contextus/context' };
}

function listExistingProjects(currentProject: string): string[] {
  try {
    // Read from projects.json (unified DB architecture)
    if (!fs.existsSync(PROJECTS_JSON)) return [];
    const raw = fs.readFileSync(PROJECTS_JSON, 'utf8');
    const projects = JSON.parse(raw) as Record<string, { name: string; path: string }>;

    // Return project names, excluding the current one
    return Object.entries(projects)
      .filter(([hash]) => hash !== currentProject)
      .map(([_, p]) => p.name)
      .filter((name, idx, arr) => arr.indexOf(name) === idx); // dedupe
  } catch {
    return [];
  }
}

function detectCorpusState(cwd: string): 'missing' | 'empty' | 'populated' {
  const contextDir = path.join(cwd, '.claude', 'context');
  if (!fs.existsSync(contextDir)) return 'missing';
  return countMdFiles(contextDir) > 0 ? 'populated' : 'empty';
}

function countUsageEntries(): number {
  try {
    const content = fs.readFileSync(USAGE_LOG, 'utf8');
    return content.split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function readCurrentConfig(cwd: string): Record<string, unknown> | null {
  const paths = [
    path.join(cwd, '.claude', 'contextus.jsonc'),
    path.join(cwd, '.claude', 'contextus.json')
  ];
  for (const p of paths) {
    try {
      const text = fs.readFileSync(p, 'utf8');
      const stripped = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      return JSON.parse(stripped);
    } catch {
      continue;
    }
  }
  return null;
}

async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function detectOllama(): Promise<OllamaState> {
  // Check if binary exists
  const hasBinary = await commandExists('ollama');

  // Check if service responds
  const serviceUp = await checkOllama();

  if (hasBinary && serviceUp) return { status: 'installed-running' };
  if (hasBinary && !serviceUp) return { status: 'installed-stopped' };
  if (!hasBinary) return { status: 'not-installed' };
  return { status: 'unreachable' };
}

async function main(): Promise<void> {
  const cwd = parseArgs();
  const project = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 12);
  const platform = detectPlatform();

  const result: DetectionResult = {
    ollamaReachable: await checkOllama(),
    ollamaState: await detectOllama(),
    platform,
    hasHomebrew: platform === 'macos' ? await hasHomebrew() : false,
    hasStanza: hasStanza(cwd),
    hasProjectConfig: hasProjectConfig(cwd),
    hasPopulatedContext: detectCorpusState(cwd) === 'populated',
    legacyMemory: detectLegacyMemory(cwd),
    projectDocs: detectProjectDocs(cwd),
    userMemory: detectUserMemory(),
    userContext: detectUserContext(),
    existingProjects: listExistingProjects(project),
    corpusState: detectCorpusState(cwd),
    usageLogEntries: countUsageEntries(),
    embeddingProvider: 'ollama',
    currentConfig: readCurrentConfig(cwd)
  };

  console.log(JSON.stringify(result, null, 2));
}

main();
