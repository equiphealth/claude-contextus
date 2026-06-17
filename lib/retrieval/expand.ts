/**
 * Multi-vector query expansion — generate alternate phrasings of the user's
 * prompt so we search with multiple embedding vectors, not one.
 *
 * Why: nomic-embed-text uses mean-pooling over tokens, so synonyms and short
 * paraphrases can land far apart in the 768-dim space. A single vector misses
 * retrieval targets that a human would consider obvious matches. Measured: 3/7
 * paraphrased queries fail entirely (below floor) with a single vector.
 *
 * The fix: generate 2-3 short rephrasings via a fast LLM, embed each, search
 * each independently, then union + dedupe results. This turns one needle in
 * the haystack into 3-4 needles — dramatically improving recall without
 * changing the embedding model or corpus.
 *
 * Provider model: configurable (ollama small model or anthropic haiku). The
 * generation prompt asks for SHORT, DIVERSE rephrasings — not summaries,
 * not expansions, just different word choices for the same intent.
 */

import type { ExpansionConfig } from '../config.js';

export interface ExpandedQueries {
  variants: string[];
  latencyMs: number;
  provider: string;
}

const EXPANSION_PROMPT = `You are a search query expander. Given a user's question, generate {{count}} SHORT alternative phrasings that would help find relevant documentation. Each variant should use DIFFERENT vocabulary/synonyms while preserving the intent.

Rules:
- Each variant must be under 30 words
- Use different terminology (e.g., "embedding model" → "vector encoder", "config" → "settings")
- Focus on the core intent, drop conversational filler
- Output ONLY the variants, one per line, no numbering or bullets

User query: {{query}}`;

function buildPrompt(query: string, count: number): string {
  return EXPANSION_PROMPT.replace('{{count}}', String(count)).replace('{{query}}', query);
}

function parseVariants(raw: string, maxVariants: number): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.length < 200)
    .slice(0, maxVariants);
}

async function expandViaOllama(query: string, cfg: ExpansionConfig): Promise<ExpandedQueries> {
  const started = Date.now();
  const body = {
    model: cfg.ollamaModel,
    prompt: buildPrompt(query, cfg.maxVariants),
    stream: false,
    options: { temperature: cfg.temperature, num_predict: 150 },
  };

  const res = await fetch(`${cfg.ollamaEndpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Ollama expansion failed: ${res.status}`);
  }

  const data = (await res.json()) as { response: string };
  const variants = parseVariants(data.response, cfg.maxVariants);

  return { variants, latencyMs: Date.now() - started, provider: `ollama/${cfg.ollamaModel}` };
}

async function expandViaAnthropic(query: string, cfg: ExpansionConfig): Promise<ExpandedQueries> {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set for expansion provider=anthropic');
  }

  const body = {
    model: cfg.anthropicModel,
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(query, cfg.maxVariants) }],
    temperature: cfg.temperature,
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Anthropic expansion failed: ${res.status}`);
  }

  const data = (await res.json()) as { content: Array<{ text: string }> };
  const text = data.content?.[0]?.text ?? '';
  const variants = parseVariants(text, cfg.maxVariants);

  return { variants, latencyMs: Date.now() - started, provider: `anthropic/${cfg.anthropicModel}` };
}

/**
 * Generate query variants for multi-vector search. Returns empty array on any
 * failure (network, timeout, bad model output) — expansion is best-effort,
 * never blocks retrieval.
 */
export async function expandQuery(query: string, cfg: ExpansionConfig): Promise<ExpandedQueries> {
  try {
    if (cfg.provider === 'anthropic') {
      return await expandViaAnthropic(query, cfg);
    }
    return await expandViaOllama(query, cfg);
  } catch {
    return { variants: [], latencyMs: 0, provider: cfg.provider };
  }
}

/**
 * Should expansion fire for this query result?
 * - mode=off → never
 * - mode=always → yes
 * - mode=adaptive → only if bestScore < expansionThreshold
 */
export function shouldExpand(
  mode: ExpansionConfig['mode'],
  bestScore: number,
  threshold: number
): boolean {
  if (mode === 'off') return false;
  if (mode === 'always') return true;
  return bestScore < threshold;
}
