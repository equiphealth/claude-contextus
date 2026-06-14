#!/usr/bin/env node
/**
 * tag-context — backfill tags on tagless context files (the /tag-context engine).
 *
 * The migration never fabricated tags (memory-to-context-migration), leaving some
 * files tagless. Tags are inert until v2 CAE, but there was no path to add them.
 * This is that path. The WHICH-tags judgment is Claude's (the skill reads each
 * file and proposes); this CLI just (a) lists tagless files and (b) writes
 * approved tags idempotently via the pure addTags writer.
 *
 * Usage:
 *   pnpm tag-context --list                       # list tagless context files (JSON)
 *   pnpm tag-context --apply <relpath> a,b,c      # write tags to one file
 *   pnpm tag-context --apply <relpath> a,b --embed  # …and re-embed it after
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { addTags } from '../lib/capture/tag-frontmatter.js';
import { embedSingleFile } from '../lib/embedding/embed-file.js';

const CONTEXT_DIR = path.resolve(process.cwd(), '.claude', 'context');

/** Read tags from either nested metadata or top-level frontmatter. */
function fileTags(data: Record<string, unknown>): string[] {
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const raw = meta.tags ?? data.tags;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string')
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  return [];
}

async function listTagless(): Promise<void> {
  if (!fs.existsSync(CONTEXT_DIR)) {
    console.log(JSON.stringify({ taglessFiles: [], note: 'no .claude/context dir' }, null, 2));
    return;
  }
  const files = await glob(path.join(CONTEXT_DIR, '**', '*.md'), {
    ignore: ['**/CONTEXT.md', '**/README.md'],
  });
  const tagless: Array<{ relpath: string; name: string; description: string }> = [];
  for (const abs of files.sort()) {
    const { data } = matter(fs.readFileSync(abs, 'utf8'));
    const d = data as Record<string, unknown>;
    if (fileTags(d).length === 0) {
      tagless.push({
        relpath: path.relative(CONTEXT_DIR, abs),
        name: String(d.name ?? path.basename(abs, '.md')),
        description: String(d.description ?? ''),
      });
    }
  }
  console.log(JSON.stringify({ taglessFiles: tagless, count: tagless.length }, null, 2));
}

async function applyTags(relpath: string, tagsCsv: string, embed: boolean): Promise<void> {
  const abs = path.resolve(CONTEXT_DIR, relpath);
  if (!abs.startsWith(CONTEXT_DIR + path.sep)) {
    console.error(`Refusing to write outside .claude/context: ${relpath}`);
    process.exit(1);
  }
  if (!fs.existsSync(abs)) {
    console.error(`Not found: ${relpath}`);
    process.exit(1);
  }
  const tags = tagsCsv
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) {
    console.error('No tags given.');
    process.exit(1);
  }
  const result = addTags(fs.readFileSync(abs, 'utf8'), tags);
  if (!result.changed) {
    console.log(`= ${relpath}: all tags already present, no change`);
    return;
  }
  fs.writeFileSync(abs, result.content);
  console.log(`✓ ${relpath}: added [${result.added.join(', ')}]`);
  if (embed) {
    const r = await embedSingleFile(abs, CONTEXT_DIR, path.basename(process.cwd()));
    console.log(`  re-embed: ${r.embedded ? 'done' : `skipped (${r.reason})`}`);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) return listTagless();
  const ai = argv.indexOf('--apply');
  if (ai !== -1 && argv[ai + 1] && argv[ai + 2]) {
    return applyTags(argv[ai + 1], argv[ai + 2], argv.includes('--embed'));
  }
  console.log(
    'Usage:\n  pnpm tag-context --list\n  pnpm tag-context --apply <relpath> tag1,tag2 [--embed]'
  );
}

main().catch((err) => {
  console.error('tag-context failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
