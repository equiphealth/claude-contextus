#!/usr/bin/env tsx
/**
 * Transcript mining CLI — extract patterns from Claude Code session logs.
 *
 * Usage:
 *   pnpm mine-transcripts                    # scan current project (incremental)
 *   pnpm mine-transcripts --since 7d         # override lookback
 *   pnpm mine-transcripts --project /path    # specific project
 *   pnpm mine-transcripts --all              # all projects
 *   pnpm mine-transcripts --dry-run          # show what would be extracted, don't write
 *   pnpm mine-transcripts --list             # list available projects
 *   pnpm mine-transcripts --help
 */

import path from 'node:path';
import {
  discoverSessions,
  parseSession,
  filterInterestingTurns,
  windowTurns,
  projectSlug,
  listProjects
} from '../lib/transcript/parser.js';
import {
  extractFromWindow,
  DEFAULT_EXTRACTION_CONFIG,
  type ExtractionConfig,
  type ExtractedPattern
} from '../lib/transcript/extractor.js';
import {
  readState,
  writeState,
  getWatermark,
  updateProjectState
} from '../lib/transcript/state.js';
import { loadConfig } from '../lib/config.js';
import { getDaemonURL } from '../lib/daemon-url.js';

interface CliArgs {
  project?: string;
  all: boolean;
  since?: string;
  dryRun: boolean;
  list: boolean;
  maxSessions: number;
  help: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = { all: false, dryRun: false, list: false, maxSessions: 3, help: false };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--project':
        result.project = args[++i];
        break;
      case '--all':
        result.all = true;
        break;
      case '--since':
        result.since = args[++i];
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--list':
        result.list = true;
        break;
      case '--max-sessions':
        result.maxSessions = parseInt(args[++i], 10) || 10;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }
  return result;
}

function parseSince(since: string | undefined, watermark: Date | null): Date | undefined {
  if (since) {
    const match = since.match(/^(\d+)([dhm])$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      const ms = unit === 'd' ? n * 86400000 : unit === 'h' ? n * 3600000 : n * 60000;
      return new Date(Date.now() - ms);
    }
    const d = new Date(since);
    if (!isNaN(d.getTime())) return d;
  }
  // Use watermark if available, otherwise default to 1 day (things move fast)
  return watermark ?? new Date(Date.now() - 1 * 86400000);
}

function buildExtractionConfig(): ExtractionConfig {
  const config = loadConfig();
  const providers = config.providers ?? {};

  return {
    ...DEFAULT_EXTRACTION_CONFIG,
    ollamaEndpoint: providers.ollama?.endpoint ?? 'http://localhost:11434',
    bedrockRegion: providers.bedrock?.region ?? 'us-east-1'
  };
}

const DEDUP_THRESHOLD = 0.82;

/** Check if a similar pattern already exists in the corpus. */
async function isDuplicate(pattern: ExtractedPattern, projectPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${getDaemonURL()}/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project: projectPath,
        prompt: `${pattern.description} ${pattern.body.slice(0, 200)}`
      }),
      signal: AbortSignal.timeout(5_000)
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    // Parse similarity scores from the response — look for score in provenance footer
    const ctx = data.hookSpecificOutput?.additionalContext ?? '';
    const scoreMatch = ctx.match(/similarity: ([\d.]+)/);
    if (scoreMatch) {
      const bestScore = parseFloat(scoreMatch[1]);
      return bestScore >= DEDUP_THRESHOLD;
    }
    // If context was injected at all, there's likely overlap
    return ctx.length > 200;
  } catch {
    return false; // On error, allow the write (false negative is cheaper than false positive)
  }
}

async function writePattern(
  pattern: ExtractedPattern,
  projectPath: string,
  dryRun: boolean
): Promise<boolean> {
  // Dedup check — skip if similar pattern already exists
  const duplicate = await isDuplicate(pattern, projectPath);
  if (duplicate) {
    console.log(`  [dedup] Skipped: ${pattern.slug} (similar pattern exists)`);
    return false;
  }

  if (dryRun) {
    console.log(
      `  [dry-run] Would write: ${pattern.category}/${pattern.category}-${pattern.slug}.md`
    );
    console.log(`            "${pattern.description}" (confidence: ${pattern.confidence})`);
    return true;
  }

  try {
    const res = await fetch(`${getDaemonURL()}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        category: pattern.category,
        slug: pattern.slug,
        description: pattern.description,
        body: pattern.body,
        tags: ['transcript-mined'],
        cwd: projectPath,
        scope: 'project'
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`  [error] /capture failed for ${pattern.slug}: ${res.status} ${err}`);
      return false;
    }
    const result = (await res.json()) as { ok: boolean; file?: string };
    if (result.ok) {
      console.log(`  ✓ Captured: ${pattern.category}/${pattern.category}-${pattern.slug}.md`);
    }
    return result.ok;
  } catch (err) {
    console.error(`  [error] /capture unreachable for ${pattern.slug}: ${err}`);
    return false;
  }
}

async function mineProject(
  projectPath: string,
  args: CliArgs,
  extractionConfig: ExtractionConfig
): Promise<{ extracted: number; sessions: number }> {
  const slug = projectSlug(projectPath);
  const watermark = getWatermark(slug);
  const since = parseSince(args.since, watermark);

  console.log(`\n📂 Project: ${projectPath}`);
  console.log(`   Slug: ${slug}`);
  console.log(`   Since: ${since?.toISOString() ?? 'beginning of time'}`);

  const sessionFiles = discoverSessions(projectPath, since);
  if (sessionFiles.length === 0) {
    console.log('   No new sessions to scan.');
    return { extracted: 0, sessions: 0 };
  }

  const capped = sessionFiles.slice(0, args.maxSessions);
  console.log(
    `   Sessions: ${capped.length}${sessionFiles.length > args.maxSessions ? ` (capped from ${sessionFiles.length})` : ''}`
  );

  let totalExtracted = 0;

  for (const file of capped) {
    const basename = path.basename(file);
    console.log(`\n   Parsing: ${basename}`);

    const turns = await parseSession(file);
    const interesting = filterInterestingTurns(turns);
    console.log(`   Turns: ${turns.length} total, ${interesting.length} interesting`);

    if (interesting.length === 0) continue;

    const windows = windowTurns(interesting);
    console.log(`   Windows: ${windows.length} (extracting...)`);

    for (let i = 0; i < windows.length; i++) {
      try {
        const result = await extractFromWindow(windows[i], i, extractionConfig);
        if (result.patterns.length > 0) {
          console.log(`   Window ${i}: ${result.patterns.length} pattern(s) found`);
          for (const pattern of result.patterns) {
            const written = await writePattern(pattern, projectPath, args.dryRun);
            if (written) totalExtracted++;
          }
        }
      } catch (err) {
        console.error(`   Window ${i}: extraction failed — ${err}`);
      }
    }
  }

  // Update watermark
  if (!args.dryRun && capped.length > 0) {
    const state = readState();
    const updated = updateProjectState(state, slug, {
      lastScanned: new Date().toISOString(),
      lastSessionFile: path.basename(capped[capped.length - 1]),
      patternsExtracted: (state.projects[slug]?.patternsExtracted ?? 0) + totalExtracted,
      sessionsProcessed: (state.projects[slug]?.sessionsProcessed ?? 0) + capped.length
    });
    writeState(updated);
  }

  return { extracted: totalExtracted, sessions: capped.length };
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    console.log(`
transcript mining — extract patterns from Claude Code session logs

Usage:
  pnpm mine-transcripts                    scan current project (incremental)
  pnpm mine-transcripts --since 7d         override lookback window
  pnpm mine-transcripts --project /path    specific project path
  pnpm mine-transcripts --all              scan all known projects
  pnpm mine-transcripts --dry-run          show extractions without writing
  pnpm mine-transcripts --list             list available projects
  pnpm mine-transcripts --max-sessions N   cap sessions per scan (default: 10)

Extracted patterns are written via POST /capture (daemon must be running).
Files appear in .claude/context/ with tag "transcript-mined".
`);
    return;
  }

  if (args.list) {
    const projects = listProjects();
    console.log('Available projects:\n');
    for (const p of projects) {
      const watermark = getWatermark(p.slug);
      const scanned = watermark
        ? `last scanned: ${watermark.toISOString().slice(0, 10)}`
        : 'never scanned';
      console.log(`  ${p.path} (${p.sessions} sessions, ${scanned})`);
    }
    return;
  }

  const extractionConfig = buildExtractionConfig();

  if (args.all) {
    const projects = listProjects();
    let totalExtracted = 0;
    let totalSessions = 0;
    for (const p of projects) {
      const result = await mineProject(p.path, args, extractionConfig);
      totalExtracted += result.extracted;
      totalSessions += result.sessions;
    }
    console.log(
      `\n✨ Done: ${totalExtracted} patterns from ${totalSessions} sessions across ${projects.length} projects`
    );
  } else {
    const projectPath = args.project ?? process.cwd();
    const result = await mineProject(projectPath, args, extractionConfig);
    console.log(`\n✨ Done: ${result.extracted} patterns from ${result.sessions} sessions`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
