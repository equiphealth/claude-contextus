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
import { exec as execCb } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { commandExists, detectPlatform, hasHomebrew, type Platform } from './install-ollama.js';
import { hasAgentsStanza, readSetupStamp } from './lib/daemon-control.js';
import type { SetupHost } from '../lib/capture/claude-md-stanza.js';
import { loadConfig } from '../lib/config.js';

const exec = promisify(execCb);

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

/**
 * Muse plugin-hook approval as reported by `muse plugins inspect contextus`
 * (Phase 0 L18: per-hook `review_needed` → `trusted_enabled` after approve).
 * `not-checked` keeps the Claude path free of a muse-CLI probe.
 */
export type MuseApproval =
  'not-checked' | 'cli-missing' | 'not-installed' | 'review_needed' | 'trusted' | 'unknown';

/**
 * Pure parser for `muse plugins inspect` output (live shapes: `status=review_needed`,
 * `status=trusted_enabled`, approve line `approve plugin:<id>:hook:<name>`).
 * Never throws; unrecognized output is `unknown`, never a guess of trusted.
 */
export function parseMuseApproval(
  _exitCode: number,
  stdout: string
): Exclude<MuseApproval, 'not-checked' | 'cli-missing'> {
  const text = String(stdout || '');
  if (/review_needed/.test(text)) return 'review_needed';
  if (/trusted_enabled/.test(text)) return 'trusted';
  // NOTE: `muse plugins inspect <missing>` exits 0 with "is not installed",
  // so the not-installed shape is checked regardless of exit code. Status
  // tokens above win over this text for an installed plugin.
  if (/no such plugin|not installed|unknown plugin/i.test(text)) return 'not-installed';
  return 'unknown';
}

/** Best-effort approval probe. Never throws — failure modes map to states. */
async function detectMuseApproval(): Promise<MuseApproval> {
  if (!(await commandExists('muse'))) return 'cli-missing';
  try {
    const { stdout } = await exec('muse plugins inspect contextus', { timeout: 10000 });
    return parseMuseApproval(0, stdout);
  } catch (err) {
    // Live shape: missing plugin exits 1 with the message on stderr.
    const e = (err ?? {}) as { stdout?: unknown; stderr?: unknown };
    return parseMuseApproval(1, `${e.stdout ?? ''}\n${e.stderr ?? ''}`);
  }
}

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
  host: SetupHost;
  hasAgentsStanza: boolean;
  setupStamp: { present: boolean; host: string | null; completedAt: string | null };
  museApproval: MuseApproval;
}

function parseArgs(): { dir: string; host: SetupHost } {
  const argv = process.argv.slice(2);
  let dir = process.cwd();
  let host: SetupHost = 'claude';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) dir = path.resolve(argv[++i]);
    else if (argv[i] === '--host' && argv[i + 1]) {
      const next = argv[++i];
      if (next !== 'claude' && next !== 'muse') {
        throw new Error(`--host must be 'claude' or 'muse', got '${next}'`);
      }
      host = next;
    } else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('setup-detect — gather project state for the setup wizard\n');
      console.log('Usage: pnpm setup-detect [--dir <path>] [--host claude|muse]');
      process.exit(0);
    }
  }
  return { dir, host };
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
  const { dir: cwd, host } = parseArgs();
  const project = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 12);
  const platform = detectPlatform();
  const stamp = readSetupStamp(cwd);

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
    // Report what's ACTUALLY decided (plugin.jsonc → DEFAULTS, same merge the
    // daemon itself loads), never a guess or a hardcoded literal. Setup must
    // conform to the machine-wide decision, not choose independently — a
    // hardcoded 'ollama' here previously lied regardless of what was really
    // configured/running, which is exactly how a project got embedded via
    // Ollama while the daemon was actually resolving to transformers
    // defaults (see gotchas/gotcha-embedding-provider-switch.md). Whether
    // this configured provider is actually viable right now (e.g. Ollama
    // configured but not installed) is reported separately via
    // ollamaReachable/ollamaState above; the wizard skill cross-references
    // the two rather than this field re-deriving availability itself.
    embeddingProvider: loadConfig().embedding.provider,
    currentConfig: readCurrentConfig(cwd),
    host,
    hasAgentsStanza: hasAgentsStanza(cwd),
    setupStamp: {
      present: stamp !== null,
      host: stamp?.host ?? null,
      completedAt: stamp?.completedAt ?? null
    },
    museApproval: host === 'muse' ? await detectMuseApproval() : 'not-checked'
  };

  console.log(JSON.stringify(result, null, 2));
}

// Run main only when invoked as a script (tsx/pnpm), not when imported for
// its pure helpers (parseMuseApproval) by the test suite.
const invokedAsScript =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main();
}
