/**
 * Memory → Context migration mapping (pure logic).
 *
 * Converts a legacy `.claude/memory/` slug file into its `.claude/context/`
 * target: prefix-scoped filename, a category folder, and target-schema
 * frontmatter (`metadata.type` + `tags`). See the memory-to-context-migration
 * decision + IMPLEMENTATION_ESTIMATE "Memory → Context Migration".
 *
 * I/O lives in scripts/migrate-memory.ts; this module only computes the plan so
 * the slug→prefix rename, type inference, and tag seeding are unit-testable
 * without touching disk.
 *
 * Naming: legacy `decision_build_execution_cadence.md` (frontmatter
 * name: build-execution-cadence, metadata.type: decision) becomes
 * `decisions/decision-build-execution-cadence.md` with type `decision`. The
 * filename head MUST equal the type so the prefix↔type gate (context-loader) and
 * the re-ranker's typeBoost both fire.
 */

import { KNOWN_CATEGORY_PREFIXES } from '../embedding/context-loader.js';

/** Parsed input: a memory file's filename + its frontmatter + body. */
export interface MemoryFile {
  /** original filename, e.g. `decision_build_execution_cadence.md` */
  filename: string;
  /** parsed frontmatter (top-level and/or nested metadata) */
  data: Record<string, unknown>;
  /** markdown body (frontmatter stripped) */
  body: string;
}

/** The computed migration target for one memory file. */
export interface MigrationPlanItem {
  /** source filename */
  from: string;
  /** target path relative to `.claude/context/`, e.g. `decisions/decision-foo.md` */
  toRelPath: string;
  /** inferred semantic type (= filename prefix) */
  type: string;
  /** kebab slug (without the type prefix) */
  slug: string;
  /** frontmatter description ('' if absent) — used for the CONTEXT.md index line */
  description: string;
  /** seeded tags (existing tags preserved; never fabricated) */
  tags: string[];
  /** rendered target frontmatter + body */
  content: string;
  /** non-fatal notes (e.g. "type inferred from filename prefix") */
  notes: string[];
}

/** Folder per category. Defaults to the type name when not specially mapped. */
const TYPE_FOLDER: Record<string, string> = {
  decision: 'decisions',
  reference: 'reference',
  project: 'project',
  implementation: 'implementation',
  arch: 'architecture',
  tradeoff: 'tradeoffs',
  gotcha: 'gotchas',
  api: 'api',
  phase: 'phases',
  schema: 'schema',
  security: 'security',
  perf: 'perf',
};

/** Normalize any string to kebab-case (lower, non-alnum → single dash). */
export function kebab(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Pull `{type, tags}` from top-level or nested `metadata.*` frontmatter. */
function readMeta(data: Record<string, unknown>): { type?: string; tags: string[] } {
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const type = (meta.type ?? data.type) as string | undefined;
  const rawTags = meta.tags ?? data.tags;
  let tags: string[] = [];
  if (Array.isArray(rawTags)) tags = rawTags.map((t) => String(t).trim()).filter(Boolean);
  else if (typeof rawTags === 'string')
    tags = rawTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
  return { type: type ? String(type) : undefined, tags };
}

/**
 * Reclassify the banned `feedback` category into a real semantic role.
 *
 * `feedback` describes provenance ("this came from feedback"), not retrieval
 * intent — CATEGORIES_AND_TAGS.md §1 calls it invalid ("method, not meaning").
 * Legacy memory leaned on it as a catch-all, so on migration we re-home each file
 * by what question it actually answers:
 *   - gotcha    → a pitfall / quirk / instability ("what went wrong?")
 *   - reference → AI-workflow meta (memory/doc process, not domain knowledge)
 *   - decision  → a resolved convention ("what did we choose?") — the default,
 *                 since most feedback is "always use X / don't use Y".
 */
export function reclassifyFeedback(file: MemoryFile): { type: string; note: string } {
  const name = typeof file.data.name === 'string' ? file.data.name : '';
  const desc = typeof file.data.description === 'string' ? file.data.description : '';
  const hay = `${file.filename} ${name} ${desc} ${file.body.slice(0, 200)}`.toLowerCase();

  // Pitfall language → gotcha (something bites you if you don't know it).
  const GOTCHA =
    /quirk|pitfall|footgun|gotcha|crash|instabilit|flak|timeout|inconsistent|unstable|do ?n['o]t await|returns? false|can return|expects? .*not|distinguish|troubleshoot/;
  // AI-process / workflow meta → reference (not domain knowledge to act on).
  const REFERENCE =
    /proactive|claude-?mem|memory file|document(ing|ation) (investigation|belongs)|search .*before|ai assistant|ai docs/;

  if (GOTCHA.test(hay)) return { type: 'gotcha', note: `feedback→gotcha (pitfall language)` };
  if (REFERENCE.test(hay))
    return { type: 'reference', note: `feedback→reference (AI-process meta)` };
  return { type: 'decision', note: `feedback→decision (resolved convention)` };
}

/**
 * Infer the semantic type. Prefer explicit frontmatter `type`; else the filename
 * prefix before the first `_`/`-` (legacy `decision_foo.md`). Falls back to
 * `reference` (the most neutral known category) with a note. The banned
 * `feedback` category (whether from frontmatter or filename) is reclassified.
 */
function inferType(file: MemoryFile, frontmatterType?: string): { type: string; note?: string } {
  if (frontmatterType === 'feedback') return reclassifyFeedback(file);
  if (frontmatterType && (KNOWN_CATEGORY_PREFIXES as readonly string[]).includes(frontmatterType)) {
    return { type: frontmatterType };
  }
  const head = file.filename.replace(/\.md$/, '').split(/[-_]/)[0];
  if (head === 'feedback') return reclassifyFeedback(file);
  if ((KNOWN_CATEGORY_PREFIXES as readonly string[]).includes(head)) {
    return { type: head, note: `type inferred from filename prefix '${head}'` };
  }
  if (frontmatterType) {
    return { type: frontmatterType, note: `type '${frontmatterType}' is not a known category` };
  }
  return { type: 'reference', note: 'no type found; defaulted to reference' };
}

/** Render YAML frontmatter + body in the target (nested-metadata) schema. */
function renderContent(
  name: string,
  description: string,
  type: string,
  tags: string[],
  body: string
): string {
  const tagLine = tags.length ? `\n  tags: [${tags.join(', ')}]` : '';
  return (
    `---\n` +
    `name: ${name}\n` +
    `description: ${description}\n` +
    `metadata:\n` +
    `  type: ${type}${tagLine}\n` +
    `---\n\n` +
    `${body.trim()}\n`
  );
}

/** Compute the migration target for a single memory file. */
export function planFile(file: MemoryFile): MigrationPlanItem {
  const notes: string[] = [];
  const { type: fmType, tags } = readMeta(file.data);
  const { type, note } = inferType(file, fmType);
  if (note) notes.push(note);

  // Slug = frontmatter name (kebabed), else filename stem with prefix stripped.
  const rawName = typeof file.data.name === 'string' ? file.data.name : '';
  let slug = rawName
    ? kebab(rawName)
    : kebab(file.filename.replace(/\.md$/, '').replace(new RegExp(`^${type}[-_]`), ''));
  // Never double the type prefix (slug 'decision-foo' under type 'decision').
  if (slug.startsWith(`${type}-`)) slug = slug.slice(type.length + 1);

  const folder = TYPE_FOLDER[type] ?? type;
  const toRelPath = `${folder}/${type}-${slug}.md`;

  const description = typeof file.data.description === 'string' ? file.data.description : '';
  const content = renderContent(slug, description, type, tags, file.body);

  if (tags.length === 0) notes.push('no tags — seed manually if useful (stored inert until v2)');

  return { from: file.filename, toRelPath, type, slug, description, tags, content, notes };
}

/** Compute the full plan for a set of memory files (sorted by target path). */
export function planMigration(files: MemoryFile[]): MigrationPlanItem[] {
  return files.map(planFile).sort((a, b) => a.toRelPath.localeCompare(b.toRelPath));
}

/** Human-readable section heading per type, in display order. */
const INDEX_SECTIONS: Array<{ type: string; heading: string }> = [
  { type: 'project', heading: 'Project' },
  { type: 'decision', heading: 'Decisions' },
  { type: 'arch', heading: 'Architecture' },
  { type: 'tradeoff', heading: 'Tradeoffs' },
  { type: 'gotcha', heading: 'Gotchas' },
  { type: 'api', heading: 'API' },
  { type: 'schema', heading: 'Schema' },
  { type: 'security', heading: 'Security' },
  { type: 'perf', heading: 'Performance' },
  { type: 'phase', heading: 'Phases' },
  { type: 'implementation', heading: 'Implementation' },
  { type: 'reference', heading: 'Reference' },
];

/**
 * Render a CONTEXT.md index from migration plan items, grouped by type. Mirrors
 * the MEMORY.md convention (one line per file: `[name](relpath) — description`).
 * Any type without a known section heading is collected under "Other" so nothing
 * is silently dropped. Generated, not hand-maintained — re-run regenerates it.
 */
export function renderContextIndex(items: MigrationPlanItem[]): string {
  const byType = new Map<string, MigrationPlanItem[]>();
  for (const it of items) {
    const arr = byType.get(it.type) ?? [];
    arr.push(it);
    byType.set(it.type, arr);
  }

  const line = (it: MigrationPlanItem): string => {
    const desc = it.description ? ` — ${it.description}` : '';
    return `- [${it.slug}](${it.toRelPath})${desc}`;
  };

  const out: string[] = [
    '# Context Index',
    '',
    'Generated by `migrate-memory`. One line per file, grouped by category. Re-running the migration regenerates this — edit the source files, not this index.',
  ];

  const known = new Set(INDEX_SECTIONS.map((s) => s.type));
  for (const { type, heading } of INDEX_SECTIONS) {
    const group = byType.get(type);
    if (!group?.length) continue;
    out.push('', `## ${heading}`, '');
    for (const it of group.sort((a, b) => a.slug.localeCompare(b.slug))) out.push(line(it));
  }

  // Anything with an unrecognized type still gets listed, never dropped.
  const others = items
    .filter((it) => !known.has(it.type))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  if (others.length) {
    out.push('', '## Other', '');
    for (const it of others) out.push(line(it));
  }

  return out.join('\n') + '\n';
}
