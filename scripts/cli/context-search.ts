#!/usr/bin/env node
/**
 * context-search CLI — Search the contextus corpus by semantic similarity or keywords.
 *
 * Usage:
 *   context-search "query text"
 *   context-search "query text" --limit 20
 *   context-search "query text" --project automation
 *   context-search "query text" --json
 *   context-search "query text" --scores  # show similarity scores
 */

import { getDaemonURL } from '../../lib/daemon-url.js';
import { projectHash } from '../../lib/config.js';
import { resolveProjectId, projectPath } from '../../lib/workspace.js';

interface SearchResult {
  file: string;
  name: string;
  description: string;
  score: number;
  type: string;
  source: string;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  project: string;
}

interface CliArgs {
  query: string;
  limit: number;
  project?: string;
  json: boolean;
  scores: boolean;
  help: boolean;
}

const USAGE = `context-search — Search the contextus corpus

Usage:
  context-search "query text" [options]

Options:
  --limit N        Max results to return (default: 10)
  --project NAME   Target project (default: current directory)
  --json           Output JSON instead of human-readable
  --scores         Show similarity scores
  --help           Show this help

Examples:
  # Search current project
  context-search "how to handle errors"

  # More results with scores
  context-search "testing patterns" --limit 20 --scores

  # Specific project
  context-search "deployment" --project automation

  # JSON output for scripting
  context-search "api patterns" --json
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    query: '',
    limit: 10,
    json: false,
    scores: false,
    help: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--scores') {
      args.scores = true;
    } else if (arg === '--limit' && i + 1 < argv.length) {
      args.limit = parseInt(argv[++i], 10);
    } else if (arg === '--project' && i + 1 < argv.length) {
      args.project = argv[++i];
    } else if (!arg.startsWith('--')) {
      args.query = arg;
    }
  }

  return args;
}

async function search(query: string, project: string, limit: number): Promise<SearchResponse> {
  const daemonUrl = getDaemonURL();
  // Normalize project to hash, then resolve to path for proper scope resolution.
  // If path lookup fails (project not registered), pass undefined for cwd so the
  // daemon scopes to just [projectId, '__user__'] without workspace siblings.
  const projectId = resolveProjectId(project);
  const cwd = projectPath(projectId) || undefined;
  const response = await fetch(`${daemonUrl}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, project: projectId, cwd, limit }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!response.ok) {
    throw new Error(`Daemon returned ${response.status}: ${response.statusText}`);
  }

  const data = (await response.json()) as { results?: any[]; project?: string };

  // The /search endpoint returns raw results with scores
  const results: SearchResult[] = (data.results || []).map((r: any) => ({
    file: r.filename || r.id,
    name: r.filename?.split('/').pop()?.replace(/\.md$/, '') || r.id,
    description: r.description || '',
    score: r.similarity,
    type: r.type,
    source: r.source
  }));

  return {
    results,
    query,
    project: data.project || projectId
  };
}

function formatResults(response: SearchResponse, showScores: boolean): string {
  const { results, query } = response;

  if (results.length === 0) {
    return `No results found for: "${query}"`;
  }

  let output = `## Search Results: "${query}"\n\n`;
  output += `Found ${results.length} matches:\n\n`;

  for (const result of results) {
    const scoreStr = showScores ? ` (${result.score.toFixed(2)})` : '';
    output += `📄 ${result.file}${scoreStr}\n`;
    output += `   ${result.description}\n`;
    if (result.type !== 'unknown') {
      output += `   Type: ${result.type}`;
      if (result.source && result.source !== 'projectContext') {
        output += ` | Source: ${result.source}`;
      }
      output += '\n';
    }
    output += '\n';
  }

  return output;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (!args.query) {
    console.error('Error: Query text required\n');
    console.log(USAGE);
    process.exit(1);
  }

  try {
    const project = args.project || projectHash(process.cwd());
    const response = await search(args.query, project, args.limit);

    if (args.json) {
      console.log(JSON.stringify(response, null, 2));
    } else {
      console.log(formatResults(response, args.scores));
    }
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      console.error('\nIs the contextus daemon running? Try: /manage-daemon start');
    }
    process.exit(1);
  }
}

main();
