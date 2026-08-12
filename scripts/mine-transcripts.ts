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

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  updateProjectState,
  acquireMiningLock,
  releaseMiningLock
} from '../lib/transcript/state.js';
import { loadProjectConfig, projectHash } from '../lib/config.js';
import { getDaemonURL } from '../lib/daemon-url.js';

interface CliArgs {
  project?: string;
  all: boolean;
  since?: string;
  dryRun: boolean;
  list: boolean;
  /** undefined = no cap (default) — process every session since the watermark. */
  maxSessions?: number;
  help: boolean;
}

/**
 * No cap by default. A prior version hardcoded `maxSessions: 3` regardless of
 * how much backlog had piled up — a project whose recurring trigger never
 * fired for weeks (see GH issue #39) would then take multiple manual runs to
 * catch up, each silently dropping most of the pending sessions with no
 * warning. Uncapped is the right default for a "catch up on everything since
 * last scan" tool; `--max-sessions` remains available for anyone who wants to
 * deliberately bound a single run (e.g. a quick spot-check).
 */
export function parseArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const result: CliArgs = { all: false, dryRun: false, list: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--project':
        result.project = argv[++i];
        break;
      case '--all':
        result.all = true;
        break;
      case '--since':
        result.since = argv[++i];
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--list':
        result.list = true;
        break;
      case '--max-sessions': {
        const n = parseInt(argv[++i], 10);
        // An explicit but unparseable value is almost certainly a typo'd flag,
        // not "the user wants unlimited" — surface it rather than silently
        // falling back to uncapped, which would mask the mistake.
        if (isNaN(n) || n <= 0) {
          console.error(
            `[warn] --max-sessions value must be a positive integer, got "${argv[i]}" — ignoring, no cap applied.`
          );
        } else {
          result.maxSessions = n;
        }
        break;
      }
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

/**
 * Reads the 3-tier MERGED config (loadProjectConfig), not the raw plugin
 * defaults — a project's `.claude/contextus.jsonc` can override the Ollama
 * endpoint or Bedrock region, and mining must honor that the same way the
 * daemon itself does (same bug class as GH issue #22's findPluginConfig fix).
 * Called PER PROJECT (not once globally) so `--all` mode picks up each
 * project's own overrides instead of reusing whichever project happened to
 * be current when the process started.
 */
function buildExtractionConfig(projectPath: string): ExtractionConfig {
  const config = loadProjectConfig(projectHash(projectPath), projectPath);
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

/** Result of a single write attempt. `infraFailure` distinguishes "we couldn't
 * even reach the daemon" from a dedup skip or a content-level rejection —
 * only the former should block watermark advancement for the file it came
 * from (see mineProject's `fileHadInfraFailure` tracking). Retrying the same
 * extracted pattern against a reachable daemon that rejected it for content
 * reasons wouldn't help, so those don't block the watermark. */
export interface WriteResult {
  written: boolean;
  infraFailure: boolean;
}

export async function writePattern(
  pattern: ExtractedPattern,
  projectPath: string,
  dryRun: boolean
): Promise<WriteResult> {
  // Dedup check — skip if similar pattern already exists
  const duplicate = await isDuplicate(pattern, projectPath);
  if (duplicate) {
    console.log(`  [dedup] Skipped: ${pattern.slug} (similar pattern exists)`);
    return { written: false, infraFailure: false };
  }

  if (dryRun) {
    console.log(
      `  [dry-run] Would write: ${pattern.category}/${pattern.category}-${pattern.slug}.md`
    );
    console.log(`            "${pattern.description}" (confidence: ${pattern.confidence})`);
    return { written: true, infraFailure: false };
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
        // Was hardcoded to 'project' regardless of content — a pattern about
        // a cross-project tool/skill/workflow got permanently mis-scoped into
        // this project's corpus with no later curation step to catch it (see
        // gotchas/gotcha-transcript-mining-hardcodes-project-scope.md). The
        // extraction LLM now classifies this per pattern (extractor.ts).
        scope: pattern.scope
      }),
      signal: AbortSignal.timeout(10_000)
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.error(`  [error] /capture failed for ${pattern.slug}: ${res.status} ${err}`);
      // Daemon IS reachable, it just rejected this request (bad body, etc.)
      // — a content/validation problem, not infra down. Don't block the
      // watermark for this.
      return { written: false, infraFailure: false };
    }
    const result = (await res.json()) as { ok: boolean; file?: string };
    if (result.ok) {
      console.log(`  ✓ Captured: ${pattern.category}/${pattern.category}-${pattern.slug}.md`);
    }
    return { written: result.ok, infraFailure: false };
  } catch (err) {
    console.error(`  [error] /capture unreachable for ${pattern.slug}: ${err}`);
    // Couldn't even reach the daemon. This is exactly the case that must NOT
    // advance the watermark past this file (independent review of #40,
    // issue #39) — otherwise a session mined while the daemon is down is
    // silently marked "scanned" and skipped forever.
    return { written: false, infraFailure: true };
  }
}

/**
 * Exported so /contextus-setup can run the one-time bootstrap scan directly
 * (in-process) rather than shelling out to a separate CLI invocation — same
 * pattern it already uses for `runReconcile`. `args` only needs the fields
 * `mineProject` actually reads (since/dryRun/maxSessions); callers outside
 * this file's own `main()` can pass a partial CliArgs-shaped object.
 */
export async function mineProject(
  projectPath: string,
  args: CliArgs
): Promise<{ extracted: number; sessions: number }> {
  const slug = projectSlug(projectPath);

  // Concurrent-run guard (independent review of PR #40, item #4, GH issue
  // #39): the SessionStart trigger fires-and-forgets, so two sessions opened
  // against the same project within the mining window could otherwise both
  // spawn a full scan of the same backlog — doubled LLM cost, duplicate
  // /capture writes (neither run has written anything yet for the other's
  // dedup check to catch). A second run just sees the lock and exits having
  // done no real work. See lib/transcript/state.ts for the lock design.
  if (!acquireMiningLock(slug)) {
    console.log(`   Skipped: another mining run for ${projectPath} is already in progress.`);
    return { extracted: 0, sessions: 0 };
  }

  try {
    return await mineProjectLocked(projectPath, args, slug);
  } finally {
    releaseMiningLock(slug);
  }
}

async function mineProjectLocked(
  projectPath: string,
  args: CliArgs,
  slug: string
): Promise<{ extracted: number; sessions: number }> {
  const extractionConfig = buildExtractionConfig(projectPath);
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

  const capped = args.maxSessions ? sessionFiles.slice(0, args.maxSessions) : sessionFiles;
  console.log(
    `   Sessions: ${capped.length}${capped.length < sessionFiles.length ? ` (capped from ${sessionFiles.length})` : ''}`
  );
  // Heads-up, not a block: extraction is an LLM call per window (Haiku/Bedrock),
  // so a large uncapped backlog (first run, or a trigger that hasn't fired in a
  // while) means real time and real cost. Informational only — uncapped stays
  // uncapped; use --max-sessions to deliberately bound a run.
  if (capped.length > 20) {
    console.log(
      `   ⚠️  ${capped.length} sessions to scan — this may take a while and calls the LLM per window. Ctrl+C to cancel, or re-run with --max-sessions N to bound it.`
    );
  }

  let totalExtracted = 0;
  // Tracks the latest file we're CONFIDENT was fully handled — the watermark
  // only ever advances to this file's mtime, never past a file that hit an
  // infra failure. Fixes two related bugs (independent review of #40):
  // (1) the watermark used to advance to `Date.now()` unconditionally
  // whenever `capped.length > 0`, even if the daemon was down for the whole
  // run — those sessions were marked "scanned" and permanently skipped;
  // (2) `--max-sessions` capping jumped the watermark to "now" instead of
  // the last processed file's own timestamp, permanently dropping whatever
  // was left of the backlog beyond the cap. Stopping at the first infra
  // failure (rather than skipping over it and continuing) keeps progress
  // contiguous — no gaps a later `--since` override would need to know about.
  let lastGoodFile: string | null = null;

  for (const file of capped) {
    const basename = path.basename(file);
    console.log(`\n   Parsing: ${basename}`);

    const turns = await parseSession(file);
    const interesting = filterInterestingTurns(turns);
    console.log(`   Turns: ${turns.length} total, ${interesting.length} interesting`);

    if (interesting.length === 0) {
      lastGoodFile = file; // nothing to extract — fully handled, not a failure
      continue;
    }

    const windows = windowTurns(interesting);
    console.log(`   Windows: ${windows.length} (extracting...)`);

    let fileHadInfraFailure = false;
    for (let i = 0; i < windows.length; i++) {
      try {
        const result = await extractFromWindow(windows[i], i, extractionConfig);
        if (result.patterns.length > 0) {
          console.log(`   Window ${i}: ${result.patterns.length} pattern(s) found`);
          for (const pattern of result.patterns) {
            const outcome = await writePattern(pattern, projectPath, args.dryRun);
            if (outcome.written) totalExtracted++;
            if (outcome.infraFailure) fileHadInfraFailure = true;
          }
        }
      } catch (err) {
        // Extraction LLM (Haiku/Bedrock) itself unreachable/erroring — same
        // "don't trust this file" treatment as a /capture infra failure.
        console.error(`   Window ${i}: extraction failed — ${err}`);
        fileHadInfraFailure = true;
      }
    }

    if (fileHadInfraFailure) {
      console.error(
        `   ⚠️  ${basename} hit an infra failure — watermark will NOT advance past it; it'll be retried next run.`
      );
      break; // stop scanning further files too — keeps watermark progress contiguous
    }
    lastGoodFile = file;
  }

  // Update watermark — advance to the last file we're confident fully
  // succeeded, using ITS OWN mtime (not Date.now()). A file's mtime is always
  // <= the moment it was scanned, so the next run's `mtime > since` filter in
  // discoverSessions correctly excludes it without an off-by-one gap.
  const sessionsProcessed = lastGoodFile ? capped.indexOf(lastGoodFile) + 1 : 0;
  if (!args.dryRun && lastGoodFile) {
    const lastGoodMtime = fs.statSync(lastGoodFile).mtime.toISOString();
    const state = readState();
    const updated = updateProjectState(state, slug, {
      lastScanned: lastGoodMtime,
      lastSessionFile: path.basename(lastGoodFile),
      patternsExtracted: (state.projects[slug]?.patternsExtracted ?? 0) + totalExtracted,
      sessionsProcessed: (state.projects[slug]?.sessionsProcessed ?? 0) + sessionsProcessed
    });
    writeState(updated);
  }

  return { extracted: totalExtracted, sessions: sessionsProcessed };
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
  pnpm mine-transcripts --max-sessions N   cap sessions per scan (default: unlimited)

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

  if (args.all) {
    const projects = listProjects();
    let totalExtracted = 0;
    let totalSessions = 0;
    for (const p of projects) {
      const result = await mineProject(p.path, args);
      totalExtracted += result.extracted;
      totalSessions += result.sessions;
    }
    console.log(
      `\n✨ Done: ${totalExtracted} patterns from ${totalSessions} sessions across ${projects.length} projects`
    );
  } else {
    const projectPath = args.project ?? process.cwd();
    const result = await mineProject(projectPath, args);
    console.log(`\n✨ Done: ${result.extracted} patterns from ${result.sessions} sessions`);
  }
}

// Only run when executed directly (`tsx scripts/mine-transcripts.ts` / `node
// dist/scripts/mine-transcripts.js`) — not when imported by tests, which would
// otherwise trigger a real CLI run (including process.exit) as an import
// side effect.
//
// Uses pathToFileURL rather than a naive `file://${process.argv[1]}` string
// comparison — import.meta.url is percent-encoded (spaces become %20),
// process.argv[1] is a raw filesystem path, so the naive comparison silently
// fails (never matches) for any install path containing a space or other
// character requiring encoding — e.g. a macOS home dir like `/Users/First
// Last/`. That would make main() never run, and since fireTranscriptMining
// spawns this with stdio:'ignore', the failure is completely silent (found
// in independent review of PR #40). daemon/server.ts has the same unsafe
// naive comparison pre-existing this PR — not fixed here, out of scope.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
