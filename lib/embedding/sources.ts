/**
 * Source resolution — turn plugin.json `config.sources` into loadable corpora.
 *
 * v1 originally embedded ONLY `.claude/context/`, even though plugin.json lists
 * multiple enabled sources (projectDocs = `docs/`, userMemory, userDocs). This
 * resolves every ENABLED source to an absolute dir + its exclude globs, and loads
 * each file tagged with its source name so the re-ranker's SOURCE_WEIGHTS engage.
 *
 * STALENESS / NOISE CAVEAT (user-flagged): docs are noisier and stale faster than
 * hand-curated context — they're long-form prose written for humans, and v1 embeds
 * them WHOLE (one vector per file; chunking is v2), so the model truncates a long
 * doc to its context window and only the head is represented. Two guards already
 * cover this: SOURCE_WEIGHTS down-ranks `projectDocs`/`userDocs` below curated
 * context, and freshnessDecay fades stale rows. Incremental re-embed on edit only
 * watches `.claude/context/`; doc sources refresh on a full `pnpm run embed`. Treat
 * docs as a supporting signal, not a primary one, until v2 chunking lands.
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { expandHome, projectLocalConfigPath } from '../config.js';
import { loadContext, type LoadedContext } from './context-loader.js';

/** One resolved, enabled source ready to load. */
export interface ResolvedSource {
  /** source name = SOURCE_WEIGHTS key (projectContext | projectDocs | userDocs …) */
  name: string;
  /** absolute directory to scan */
  dir: string;
  /** glob patterns to skip (index file, READMEs) */
  exclude: string[];
}

/** A loaded file plus the source it came from (for the `source` column). */
export interface SourcedContext {
  context: LoadedContext;
  source: string;
}

/**
 * Map a plugin.json source entry to the SOURCE_WEIGHTS key the re-ranker uses.
 * The config keys (`projectMemory`) predate the rename to `projectContext`; both
 * are present in SOURCE_WEIGHTS, but we normalize a project memory/context source
 * to `projectContext` so the curated-context weight (1.0) applies.
 */
function sourceWeightKey(configKey: string): string {
  if (configKey === 'projectMemory') return 'projectContext';
  if (configKey === 'userMemory') return 'userContext';
  return configKey;
}

interface RawSource {
  type?: string;
  path?: string;
  enabled?: boolean;
  indexFile?: string;
  exclude?: string[];
}

/**
 * Resolve every enabled source from plugin.json `config.sources` to a loadable
 * dir. Skips disabled sources and ones whose directory doesn't exist (a user
 * without `~/.claude/docs` just doesn't get that pack — not an error).
 */
export function resolveSources(pluginConfig: Record<string, unknown>): ResolvedSource[] {
  const sources = (pluginConfig.sources ?? {}) as Record<string, RawSource>;
  const out: ResolvedSource[] = [];
  for (const [key, s] of Object.entries(sources)) {
    if (!s || s.enabled === false || !s.path) continue;
    const dir = path.resolve(expandHome(s.path));
    if (!fs.existsSync(dir)) continue;
    const exclude = s.exclude ?? ['**/CONTEXT.md', '**/DOCS.md', '**/README.md'];
    out.push({ name: sourceWeightKey(key), dir, exclude });
  }
  return out;
}

/** Load every markdown file in a source dir, tagged with the source name. */
export async function loadSource(src: ResolvedSource): Promise<SourcedContext[]> {
  // cwd-relative glob, not an absolute pattern: an absolute pattern matches the
  // `ignore` globs against absolute paths, so `**/CONTEXT.md` fails to exclude a
  // root-level index file (same bug that gave reconcile a phantom "new" file).
  // Anchor each exclude with a bare-basename variant so root-level indexes drop.
  const ignore = src.exclude.flatMap((g) => (g.startsWith('**/') ? [g, g.slice(3)] : [g]));
  const rel = await glob('**/*.md', { cwd: src.dir, ignore });
  return rel
    .sort()
    .map((f) => ({ context: loadContext(path.join(src.dir, f), src.dir), source: src.name }));
}

/**
 * Load all enabled sources. Dedups by source-qualified id (a file can't appear
 * twice within one source). Returns the sourced contexts in source order.
 */
export async function loadAllSources(sources: ResolvedSource[]): Promise<SourcedContext[]> {
  const out: SourcedContext[] = [];
  for (const src of sources) {
    out.push(...(await loadSource(src)));
  }
  return out;
}

/* ── Linked Projects ─────────────────────────────────────────────────────────── */

export interface LinkedProjectEntry {
  name: string;
  path: string;
  enabled?: boolean;
}

/**
 * Read linked projects from the tier-2 config (machine-local).
 * Returns an empty array if no config or no linkedProjects key.
 */
export function readLinkedProjects(projectName: string): LinkedProjectEntry[] {
  const configPath = projectLocalConfigPath(projectName);
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Array.isArray(raw.linkedProjects) ? raw.linkedProjects : [];
  } catch {
    return [];
  }
}

/**
 * Resolve linked projects into ResolvedSource entries.
 * Each linked project's `.claude/context/` becomes a source named
 * 'linkedContext:<name>' — the suffix disambiguates rows per link so
 * orphan cleanup can target a single removed project without nuking all
 * linked rows. The reranker's weight() resolves the prefix ('linkedContext')
 * for ranking purposes.
 *
 * Skips entries that are disabled or whose context dir doesn't exist.
 */
export function resolveLinkedSources(projectName: string): ResolvedSource[] {
  const linked = readLinkedProjects(projectName);
  const out: ResolvedSource[] = [];
  for (const entry of linked) {
    if (entry.enabled === false) continue;
    const dir = path.resolve(expandHome(entry.path), '.claude', 'context');
    if (!fs.existsSync(dir)) continue;
    out.push({
      name: `linkedContext:${entry.name}`,
      dir,
      exclude: ['**/CONTEXT.md', '**/README.md']
    });
  }
  return out;
}

/**
 * Return linked entries whose context directory no longer exists.
 * Used by reconcile to clean up orphan rows from removed/moved projects.
 */
export function findMissingLinkedProjects(projectName: string): LinkedProjectEntry[] {
  const linked = readLinkedProjects(projectName);
  return linked.filter((entry) => {
    if (entry.enabled === false) return false;
    const dir = path.resolve(expandHome(entry.path), '.claude', 'context');
    return !fs.existsSync(dir);
  });
}
