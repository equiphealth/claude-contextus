#!/usr/bin/env node
/**
 * migrate-memory — convert `.claude/memory/` slug files into `.claude/context/`
 * prefix-scoped, typed, tagged files, and repoint plugin.json's source path.
 *
 * Owns the recurring slug→prefix rename + type inference + tag seeding so it's
 * repeatable and consistent (memory-to-context-migration decision). The pure
 * mapping lives in lib/memory-migrate.ts; this script does the I/O and safety.
 *
 * SAFETY CONTRACT (IMPLEMENTATION_ESTIMATE "Memory → Context Migration"):
 *   - DRY-RUN BY DEFAULT — prints the plan (slug → prefix-name, type, tags) and
 *     writes nothing. `--apply` is required to touch disk.
 *   - IDEMPOTENT — a target that already exists is skipped, so a re-run after an
 *     interruption never half-converts or clobbers.
 *   - VERIFY-BEFORE-EMBED — it converts files into the INJECTED corpus, so it
 *     never auto-embeds. After --apply it prints the exact `pnpm run embed`
 *     command for you to run once you've eyeballed the converted files.
 *
 * Usage:
 *   pnpm migrate-memory                       # dry-run, contextus's own memory
 *   pnpm migrate-memory --project <path>      # dry-run, target another project
 *   pnpm migrate-memory --apply               # write files (still no embed)
 *   pnpm migrate-memory --apply --repoint     # also flip plugin.json source path
 *
 * --project <path>: resolve the project's `.claude/memory` and `.claude/context`
 * from <path> instead of the contextus repo itself, so this migrates ARBITRARY
 * projects (the repo-scoped `__dirname` default only ever saw contextus's own
 * memory). plugin.json still lives in — and is repointed in — the contextus repo,
 * since `config.sources` is global and resolved against cwd at embed time.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import matter from 'gray-matter';
import { stripJsonComments } from '../lib/config.js';
import {
  planMigration,
  renderContextIndex,
  type MemoryFile,
  type MigrationPlanItem
} from '../lib/capture/memory-migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const REPOINT = args.includes('--repoint');

/** Resolve the project root: --project <path>, else the contextus repo itself. */
function resolveProjectRoot(argv: string[]): string {
  const i = argv.indexOf('--project');
  if (i !== -1 && argv[i + 1]) return path.resolve(argv[i + 1]);
  return REPO_ROOT;
}

const PROJECT_ROOT = resolveProjectRoot(args);
const MEMORY_DIR = path.join(PROJECT_ROOT, '.claude', 'memory');
const CONTEXT_DIR = path.join(PROJECT_ROOT, '.claude', 'context');
// plugin config source is global (resolved against cwd at embed time), so
// the repoint always targets the contextus repo's plugin config, not the project's.
const PLUGIN_JSONC_PATH = path.join(REPO_ROOT, 'plugin.jsonc');
const PLUGIN_JSON = fs.existsSync(PLUGIN_JSONC_PATH)
  ? PLUGIN_JSONC_PATH
  : path.join(REPO_ROOT, 'plugin.json');

/** Load every memory file (excluding the MEMORY.md index) as MemoryFile inputs. */
async function loadMemoryFiles(): Promise<MemoryFile[]> {
  if (!fs.existsSync(MEMORY_DIR)) return [];
  // Recursive: legacy memory dirs are often organized into topic subfolders
  // (framework/, testing/, …). A flat `*.md` glob silently skips all nested
  // files — and since embed globs `**/*.md`, that ships a hollow corpus with a
  // green checkmark. Walk the whole tree.
  const files = await glob(path.join(MEMORY_DIR, '**', '*.md'), { ignore: ['**/MEMORY.md'] });
  return files.sort().map((abs) => {
    const raw = fs.readFileSync(abs, 'utf8');
    const { data, content } = matter(raw);
    return {
      filename: path.basename(abs),
      data: data as Record<string, unknown>,
      body: content
    };
  });
}

/** Print one plan item compactly. */
function printItem(item: MigrationPlanItem, status: string): void {
  console.log(`  ${status}  ${item.from}`);
  console.log(`        → context/${item.toRelPath}  [type=${item.type}, tags=${item.tags.length}]`);
  for (const note of item.notes) console.log(`        · ${note}`);
}

/** Repoint plugin config memory sources at `.claude/context` (idempotent). */
function repointPluginJson(): boolean {
  const cfg = JSON.parse(stripJsonComments(fs.readFileSync(PLUGIN_JSON, 'utf8')));
  let changed = false;
  const proj = cfg?.config?.sources?.projectMemory;
  if (proj && proj.path !== '.claude/context') {
    proj.path = '.claude/context';
    proj.type = 'context';
    proj.indexFile = 'CONTEXT.md';
    proj.exclude = ['**/CONTEXT.md', '**/README.md'];
    changed = true;
  }
  if (changed) fs.writeFileSync(PLUGIN_JSON, JSON.stringify(cfg, null, 2) + '\n');
  return changed;
}

async function main(): Promise<void> {
  const memFiles = await loadMemoryFiles();
  if (memFiles.length === 0) {
    console.log(`No memory files under ${MEMORY_DIR} — nothing to migrate.`);
    return;
  }

  const plan = planMigration(memFiles);
  console.log(`migrate-memory ${APPLY ? '(APPLY)' : '(dry-run — pass --apply to write)'}`);
  console.log(
    `  project: ${PROJECT_ROOT}${PROJECT_ROOT === REPO_ROOT ? ' (contextus itself — pass --project to target another)' : ''}`
  );
  console.log(`  source:  ${MEMORY_DIR} (${memFiles.length} files)`);
  console.log(`  target:  ${CONTEXT_DIR}\n`);

  let written = 0;
  let skipped = 0;
  for (const item of plan) {
    const targetAbs = path.join(CONTEXT_DIR, item.toRelPath);
    const exists = fs.existsSync(targetAbs);
    if (exists) {
      printItem(item, 'SKIP (exists)');
      skipped++;
      continue;
    }
    if (APPLY) {
      fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
      fs.writeFileSync(targetAbs, item.content);
      written++;
      printItem(item, 'WROTE');
    } else {
      printItem(item, 'PLAN');
    }
  }

  console.log(
    `\n${APPLY ? `Wrote ${written}, skipped ${skipped} existing.` : `${plan.length} files planned (dry-run, nothing written).`}`
  );

  if (APPLY) {
    // Regenerate CONTEXT.md so the index never drifts from the files on disk
    // (MEMORY.md convention). Generated artifact — edit sources, not this.
    const indexPath = path.join(CONTEXT_DIR, 'CONTEXT.md');
    fs.mkdirSync(CONTEXT_DIR, { recursive: true });
    fs.writeFileSync(indexPath, renderContextIndex(plan));
    console.log(`  wrote index: ${indexPath} (${plan.length} entries)`);
  }

  if (APPLY && REPOINT) {
    const changed = repointPluginJson();
    console.log(
      changed
        ? '  plugin.json: projectMemory source repointed to .claude/context'
        : '  plugin.json: source already points at .claude/context (no change)'
    );
  }

  if (APPLY) {
    // VERIFY-BEFORE-EMBED: never auto-embed migrated truth into the corpus.
    console.log('\nNext: review the converted files, then re-embed manually:\n  pnpm run embed');
  } else {
    console.log('\nRe-run with --apply to write (add --repoint to flip plugin.json too).');
  }
}

main().catch((err) => {
  console.error('\n✗ migrate-memory failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
