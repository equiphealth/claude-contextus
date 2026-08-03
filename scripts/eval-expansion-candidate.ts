#!/usr/bin/env node
/**
 * Ad-hoc comparison harness for candidate expansion models — NOT wired into
 * the daemon, not run in CI. Exists to answer one question empirically:
 * "does model X hallucinate less than qwen2.5:3b on the known bad prompt
 * from gotcha-expansion-hallucination-inflates-injection-score.md?"
 *
 * Reuses the REAL buildPrompt()/parseVariants() from lib/retrieval/expand.ts
 * so the prompt sent here is byte-identical to what the daemon actually
 * sends in production — not a hand-approximated copy that could drift.
 *
 * The Haiku run goes further: it calls the real exported expandQuery()
 * orchestrator (not a hand-rolled Bedrock call), with provider/model set to
 * exactly the production fallback (bedrock / us.anthropic.claude-haiku-4-5-
 * 20251001-v1:0 per plugin.jsonc) — so it exercises the actual fallback code
 * path, not an approximation of it. Requires live AWS credentials.
 *
 * Usage:
 *   npx tsx scripts/eval-expansion-candidate.ts
 *   npx tsx scripts/eval-expansion-candidate.ts --model phi4-mini
 *   npx tsx scripts/eval-expansion-candidate.ts --prompt "some other query"
 *   npx tsx scripts/eval-expansion-candidate.ts --haiku   (adds a 3rd run via real expandQuery()/bedrock)
 */

import { buildPrompt, parseVariants, expandQuery } from '../lib/retrieval/expand.js';

const OLLAMA_ENDPOINT = 'http://localhost:11434';
const TEMPERATURE = 0.7; // matches plugin.jsonc expansion.temperature
const MAX_VARIANTS = 3; // matches plugin.jsonc expansion.maxVariants
const NUM_PREDICT = 150; // matches lib/retrieval/expand.ts expandViaOllama

// The exact known-bad case from gotcha-expansion-hallucination-inflates-injection-score.md.
// qwen2.5:3b interpreted "codebase-memory-mcp" (an MCP server name) as a GAME,
// producing "match"/"game"/"scoreboard" variants — a wrong frame that then
// string-collided with an unrelated stored pattern at a score above the floor.
const DEFAULT_PROMPT = 'What was the score on codebase-memory-mcp?';

interface RunResult {
  model: string;
  latencyMs: number;
  raw: string;
  variants: string[];
}

async function runOllama(model: string, prompt: string): Promise<RunResult> {
  const started = Date.now();
  const res = await fetch(`${OLLAMA_ENDPOINT}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(prompt, MAX_VARIANTS),
      stream: false,
      options: { temperature: TEMPERATURE, num_predict: NUM_PREDICT }
    }),
    signal: AbortSignal.timeout(30_000) // generous — this is a manual eval run, not production
  });
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { response: string };
  return {
    model,
    latencyMs: Date.now() - started,
    raw: data.response,
    variants: parseVariants(data.response, MAX_VARIANTS)
  };
}

function printResult(label: string, result: RunResult): void {
  console.log(`\n=== ${label} (${result.model}) — ${result.latencyMs}ms ===`);
  console.log('Raw output:');
  console.log(result.raw.trim());
  console.log('\nParsed variants:');
  result.variants.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));
}

const HAIKU_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'; // matches plugin.jsonc fallbackModel

async function runHaiku(prompt: string): Promise<RunResult> {
  const started = Date.now();
  // Real expandQuery() orchestrator, provider forced to bedrock/Haiku directly
  // (no ollama primary in this call) — exercises the actual expandViaBedrock
  // code path, not a hand-rolled approximation of it.
  const result = await expandQuery(
    prompt,
    {
      mode: 'always',
      provider: 'bedrock',
      model: HAIKU_MODEL,
      expansionThreshold: 1, // irrelevant here — expandQuery doesn't gate, shouldExpand does
      maxVariants: MAX_VARIANTS,
      temperature: TEMPERATURE,
      timeoutMs: 10_000
    },
    { bedrock: { region: 'us-east-1' } } as any
  );
  return {
    model: `bedrock/${HAIKU_MODEL}`,
    latencyMs: Date.now() - started,
    raw: result.variants.join('\n'),
    variants: result.variants
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf('--model');
  const candidateModel = modelIdx !== -1 ? args[modelIdx + 1] : 'phi4-mini';
  const promptIdx = args.indexOf('--prompt');
  const prompt = promptIdx !== -1 ? args[promptIdx + 1] : DEFAULT_PROMPT;
  const includeHaiku = args.includes('--haiku');

  console.log(`Prompt under test: "${prompt}"`);
  console.log(
    `Baseline: qwen2.5:3b   Candidate: ${candidateModel}${includeHaiku ? '   +Haiku (bedrock)' : ''}`
  );

  const baseline = await runOllama('qwen2.5:3b', prompt);
  printResult('BASELINE', baseline);

  const candidate = await runOllama(candidateModel, prompt);
  printResult('CANDIDATE', candidate);

  if (includeHaiku) {
    const haiku = await runHaiku(prompt);
    printResult('HAIKU (production fallback)', haiku);
  }

  console.log('\n=== Manual check ===');
  console.log(
    'Does the baseline reproduce the known hallucination (variants framed around a "game"/"match"/"scoreboard")?'
  );
  console.log(
    'Does the candidate stay grounded in the actual ambiguous-but-plausible interpretations instead (e.g. retrieval/similarity scoring, MCP server), rather than committing to one wrong frame?'
  );
}

main().catch((err) => {
  console.error('eval failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
