/**
 * Context loader — read and parse `.claude/context/` markdown files.
 *
 * Frontmatter schema note: the corpus is mid-migration (see the
 * memory-to-context-migration decision), so two shapes coexist:
 *   1. top-level     — `type: decision`, `tags: [a, b]`
 *   2. nested under  — `metadata: { type: decision, tags: [a, b] }`
 * Both are accepted; nested `metadata.*` wins when present (it's the target
 * schema per CATEGORIES_AND_TAGS.md). `tags` may be a YAML list or a
 * comma-separated string; it is always normalized to string[].
 */

import fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import matter from 'gray-matter';

/** Category prefixes with a defined retrieval intent (CATEGORIES_AND_TAGS.md §11). */
export const KNOWN_CATEGORY_PREFIXES = [
  'arch',
  'decision',
  'tradeoff',
  'gotcha',
  'api',
  'phase',
  'project',
  'schema',
  'security',
  'perf',
  // legacy memory types still present pre-migration. `feedback` is BANNED
  // (CATEGORIES_AND_TAGS.md §1: provenance, not meaning) — migrate-memory's
  // reclassifyFeedback re-homes it to decision/gotcha/reference on conversion.
  'reference',
  'implementation'
] as const;

/** A parsed context file, ready to embed. */
export interface LoadedContext {
  /** stable id = path relative to the context dir */
  id: string;
  /** absolute path on disk */
  absPath: string;
  /** path relative to the context dir */
  relPath: string;
  /** frontmatter name, or filename stem */
  name: string;
  /** frontmatter description ('' if absent) */
  description: string;
  /** semantic role (frontmatter type), 'unknown' if absent */
  type: string;
  /** normalized topic tags */
  tags: string[];
  /** markdown body with frontmatter stripped */
  content: string;
  /** mtime in ms (staleness checks) */
  mtime: number;
}

/** Normalize a frontmatter `tags` value (list | csv string | absent) to string[]. */
function normalizeTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [];
}

/** Resolve type + tags from either top-level or nested `metadata.*` frontmatter. */
function resolveTypeAndTags(data: Record<string, unknown>): { type: string; tags: string[] } {
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const type = String(meta.type ?? data.type ?? 'unknown');
  const tags = normalizeTags(meta.tags ?? data.tags);
  return { type, tags };
}

/**
 * Derive the category prefix from a filename, if it is a known category.
 * `decision-foo.md` → `decision`; `eslint-rules.md` → null (no known prefix).
 * Both `-` and `_` separators are recognized (legacy memory used `decision_`).
 */
export function categoryPrefix(relPath: string): string | null {
  const stem = path.basename(relPath, '.md');
  const head = stem.split(/[-_]/)[0];
  return (KNOWN_CATEGORY_PREFIXES as readonly string[]).includes(head) ? head : null;
}

/** Load and parse a single context file. */
export function loadContext(absPath: string, contextDir: string): LoadedContext {
  const raw = fs.readFileSync(absPath, 'utf8');
  const { data, content } = matter(raw);
  const relPath = path.relative(contextDir, absPath);
  const { type, tags } = resolveTypeAndTags(data as Record<string, unknown>);
  return {
    id: relPath,
    absPath,
    relPath,
    name: String(data.name ?? path.basename(absPath, '.md')),
    description: String(data.description ?? ''),
    type,
    tags,
    content: content.trim(),
    mtime: fs.statSync(absPath).mtimeMs
  };
}

/**
 * Load every context file under a directory (excluding the CONTEXT.md index and
 * README.md). Returns [] if the directory does not exist.
 */
export async function loadContexts(contextDir: string): Promise<LoadedContext[]> {
  if (!fs.existsSync(contextDir)) return [];
  // Glob relative to `contextDir` (cwd), NOT an absolute pattern: with an absolute
  // pattern, glob matches `ignore` against absolute result paths and `**/CONTEXT.md`
  // FAILS to exclude `<dir>/CONTEXT.md` at the root — leaving the generated index
  // in the set, which reconcile then counts as a perpetual phantom "new" file
  // ("re-embedding 1" every session, embedding nothing). Anchored basenames +
  // cwd-relative glob exclude it reliably at any depth.
  const rel = await glob('**/*.md', {
    cwd: contextDir,
    ignore: ['CONTEXT.md', '**/CONTEXT.md', 'README.md', '**/README.md']
  });
  return rel.sort().map((f) => loadContext(path.join(contextDir, f), contextDir));
}

/** Result of a prefix↔type consistency check. */
export interface PrefixTypeIssue {
  relPath: string;
  prefix: string;
  type: string;
}

/**
 * Reject files whose filename category prefix disagrees with frontmatter `type`
 * (cheap corpus hygiene, IMPLEMENTATION_ESTIMATE Phase 1). Only flags files that
 * HAVE a known prefix AND a declared type that differ — files without a category
 * prefix (e.g. `eslint-rules.md`) or without a type are left alone.
 */
export function findPrefixTypeMismatches(contexts: LoadedContext[]): PrefixTypeIssue[] {
  const issues: PrefixTypeIssue[] = [];
  for (const c of contexts) {
    const prefix = categoryPrefix(c.relPath);
    if (prefix && c.type !== 'unknown' && c.type !== prefix) {
      issues.push({ relPath: c.relPath, prefix, type: c.type });
    }
  }
  return issues;
}
