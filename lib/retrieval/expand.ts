/**
 * Multi-vector query expansion — generate alternate phrasings of the user's
 * prompt so we search with multiple embedding vectors, not one.
 *
 * Provider support: ollama (local), anthropic (direct API), bedrock (AWS).
 * Fallback chain: if primary provider fails fast, tries fallback with remaining
 * time budget. Slow failures (timeout) degrade gracefully without fallback.
 */

import type { ExpansionConfig, LLMProviderType, ProvidersConfig } from '../config.js';

export interface ExpandedQueries {
  variants: string[];
  latencyMs: number;
  provider: string;
}

/** Resolved provider connection details passed to expand functions. */
interface ProviderContext {
  type: LLMProviderType;
  model: string;
  ollamaEndpoint?: string;
  bedrockRegion?: string;
  timeoutMs: number;
  temperature: number;
  maxVariants: number;
}

const EXPANSION_PROMPT = `TASK: Rephrase the query below into {{count}} alternative search queries. Do NOT answer the query. Do NOT explain anything. Output ONLY the rephrased queries, one per line.

RULES:
- Each rephrasing must be a SHORT question or phrase (under 20 words)
- Use DIFFERENT words/synonyms (e.g. "embedding model" → "vector encoder", "config" → "settings")
- Preserve the original intent — just change the wording
- No numbering, no bullets, no preamble, no explanation

EXAMPLE:
Query: How do I configure the database connection?
Output:
database connection settings
set up db config
where to change database URL

Query: {{query}}
Output:`;

export function buildPrompt(query: string, count: number): string {
  return EXPANSION_PROMPT.replace('{{count}}', String(count)).replace('{{query}}', query);
}

export function parseVariants(raw: string, maxVariants: number): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 5 && l.length < 200)
    .slice(0, maxVariants);
}

async function expandViaOllama(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  const started = Date.now();
  const body = {
    model: ctx.model,
    prompt: buildPrompt(query, ctx.maxVariants),
    stream: false,
    options: { temperature: ctx.temperature, num_predict: 150 }
  };

  const res = await fetch(`${ctx.ollamaEndpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ctx.timeoutMs)
  });

  if (!res.ok) throw new Error(`Ollama expansion failed: ${res.status}`);

  const data = (await res.json()) as { response: string };
  const variants = parseVariants(data.response, ctx.maxVariants);
  return { variants, latencyMs: Date.now() - started, provider: `ollama/${ctx.model}` };
}

async function expandViaAnthropic(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  const started = Date.now();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set for expansion provider=anthropic');

  const body = {
    model: ctx.model,
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(query, ctx.maxVariants) }],
    temperature: ctx.temperature
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ctx.timeoutMs)
  });

  if (!res.ok) throw new Error(`Anthropic expansion failed: ${res.status}`);

  const data = (await res.json()) as { content: Array<{ text: string }> };
  const text = data.content?.[0]?.text ?? '';
  const variants = parseVariants(text, ctx.maxVariants);
  return { variants, latencyMs: Date.now() - started, provider: `anthropic/${ctx.model}` };
}

async function expandViaBedrock(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  const started = Date.now();
  const region = ctx.bedrockRegion || 'us-east-1';

  // Dynamic import — only loaded when bedrock is actually used
  const { BedrockRuntimeClient, InvokeModelCommand } =
    await import('@aws-sdk/client-bedrock-runtime');

  const client = new BedrockRuntimeClient({ region });
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 200,
    messages: [{ role: 'user', content: buildPrompt(query, ctx.maxVariants) }],
    temperature: ctx.temperature
  });

  const command = new InvokeModelCommand({
    modelId: ctx.model,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body)
  });

  const response = await client.send(command, {
    requestTimeout: ctx.timeoutMs
  });

  const result = JSON.parse(new TextDecoder().decode(response.body)) as {
    content: Array<{ text: string }>;
  };
  const text = result.content?.[0]?.text ?? '';
  const variants = parseVariants(text, ctx.maxVariants);
  return { variants, latencyMs: Date.now() - started, provider: `bedrock/${ctx.model}` };
}

async function callProvider(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  switch (ctx.type) {
    case 'ollama':
      return expandViaOllama(query, ctx);
    case 'anthropic':
      return expandViaAnthropic(query, ctx);
    case 'bedrock':
      return expandViaBedrock(query, ctx);
  }
}

/**
 * Generate query variants for multi-vector search. Returns empty array on any
 * failure (network, timeout, bad model output) — expansion is best-effort,
 * never blocks retrieval.
 *
 * Fallback: if primary provider fails FAST and there's remaining time budget,
 * tries the configured fallback provider. Slow failures (timeout exhausted)
 * do NOT fall back — don't pile latency on top of latency.
 */
export async function expandQuery(
  query: string,
  cfg: ExpansionConfig,
  providers?: ProvidersConfig
): Promise<ExpandedQueries> {
  const started = Date.now();
  const ollamaEndpoint = providers?.ollama?.endpoint || 'http://localhost:11434';
  const bedrockRegion = providers?.bedrock?.region || 'us-east-1';

  const primaryCtx: ProviderContext = {
    type: cfg.provider,
    model: cfg.model,
    ollamaEndpoint,
    bedrockRegion,
    timeoutMs: cfg.timeoutMs,
    temperature: cfg.temperature,
    maxVariants: cfg.maxVariants
  };

  try {
    return await callProvider(query, primaryCtx);
  } catch {
    // Fallback: primary failed fast → try fallback with remaining budget
    if (cfg.fallbackProvider && cfg.fallbackModel) {
      const elapsed = Date.now() - started;
      const remaining = cfg.timeoutMs - elapsed;
      if (remaining > 500) {
        try {
          const fallbackCtx: ProviderContext = {
            type: cfg.fallbackProvider,
            model: cfg.fallbackModel,
            ollamaEndpoint,
            bedrockRegion,
            timeoutMs: remaining,
            temperature: cfg.temperature,
            maxVariants: cfg.maxVariants
          };
          return await callProvider(query, fallbackCtx);
        } catch {
          // Both failed — degrade gracefully
        }
      }
    }
    return { variants: [], latencyMs: Date.now() - started, provider: cfg.provider };
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
