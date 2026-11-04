/**
 * Multi-vector query expansion — generate alternate phrasings of the user's
 * prompt so we search with multiple embedding vectors, not one.
 *
 * Provider support: ollama (local), anthropic (direct API), bedrock (AWS).
 * Fallback chain: if primary provider fails fast, tries fallback with remaining
 * time budget. Slow failures (timeout) degrade gracefully without fallback.
 */

import type { ExpansionConfig, LLMProviderType, ProvidersConfig } from '../config.js';
import {
  describeApiKeyFileFailure,
  META_API_KEY_ENV_DEFAULT,
  META_API_KEY_ENV_FALLBACK,
  META_DEFAULT_MODEL,
  META_ENDPOINT_DEFAULT,
  readApiKeyFile
} from '../config.js';

export interface ExpandedQueries {
  variants: string[];
  latencyMs: number;
  provider: string;
  /**
   * Set only for a configured-but-broken credential (key file missing,
   * unreadable, or empty) — never for an ordinary network/timeout failure,
   * which stays silent per the fail-open contract. Surfaced by the daemon
   * into the actual model-visible response, not just daemon.log: a
   * misconfigured key makes expansion silently fall back to a different
   * provider (or degrade to no expansion at all), and without this making
   * it into what the model/user actually sees, that looks identical to
   * "everything's fine" from inside a session — the exact confusing-demo
   * failure mode this whole mechanism exists to avoid.
   */
  warning?: string;
}

/** Extract a key-file failure message from a caught error, else undefined. */
function keyFileWarningFrom(err: unknown): string | undefined {
  return err instanceof Error && /key file/.test(err.message) ? err.message : undefined;
}

/** Resolved provider connection details passed to expand functions. */
interface ProviderContext {
  type: LLMProviderType;
  model: string;
  ollamaEndpoint?: string;
  bedrockRegion?: string;
  metaEndpoint?: string;
  metaApiKeyEnv?: string;
  metaApiKeyFile?: string;
  anthropicApiKeyFile?: string;
  timeoutMs: number;
  temperature: number;
  maxVariants: number;
}

/**
 * Resolve the Meta API key. `apiKeyFile` wins when configured — and failing
 * there is NOT a silent fall-through to env vars: a configured-but-broken
 * file is a loud, specific error (missing/unreadable/empty + the exact
 * path), never a quiet demote to "no key" that degrades to the fallback
 * provider and makes it look like Meta ran when it didn't. Only when
 * apiKeyFile is unset at all does env resolution apply, for backward
 * compatibility with env-only setups. Never logs key contents either way.
 */
export function resolveMetaApiKey(apiKeyEnv?: string, apiKeyFile?: string): string | undefined {
  if (apiKeyFile) {
    const result = readApiKeyFile(apiKeyFile);
    if (!result.ok) throw new Error(`Meta expansion: ${describeApiKeyFileFailure(result)}`);
    return result.key;
  }
  return (
    process.env[apiKeyEnv || META_API_KEY_ENV_DEFAULT] ||
    process.env[META_API_KEY_ENV_FALLBACK] ||
    undefined
  );
}

/** Same apiKeyFile-wins contract as resolveMetaApiKey, for the Anthropic provider. */
export function resolveAnthropicApiKey(apiKeyFile?: string): string | undefined {
  if (apiKeyFile) {
    const result = readApiKeyFile(apiKeyFile);
    if (!result.ok) throw new Error(`Anthropic expansion: ${describeApiKeyFileFailure(result)}`);
    return result.key;
  }
  return process.env.ANTHROPIC_API_KEY || undefined;
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
  const apiKey = resolveAnthropicApiKey(ctx.anthropicApiKeyFile);
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY not set for expansion provider=anthropic (or configure providers.anthropic.apiKeyFile)'
    );
  }

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

/**
 * Meta Model API over raw fetch (OpenAI-compatible chat completions).
 *
 * Contract status: third-party client consensus (promptfoo, litellm,
 * llm-meta-ai — base https://api.meta.ai/v1 with a Bearer key, chat completions
 * shape); documented by third-party clients only — official reference pages
 * 404’d during Phase 1 research, so the wire shape stays provisional until a live call promotes it.
 * Fail-open like every other provider: missing key or API error throws, and
 * expandQuery degrades to variants: [] (or the configured fallback).
 */
async function expandViaMeta(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  const started = Date.now();
  const apiKey = resolveMetaApiKey(ctx.metaApiKeyEnv, ctx.metaApiKeyFile);
  if (!apiKey) {
    throw new Error(
      `Meta expansion needs a key: set ${ctx.metaApiKeyEnv || META_API_KEY_ENV_DEFAULT} (or ${META_API_KEY_ENV_FALLBACK}), or configure providers.meta.apiKeyFile`
    );
  }
  const endpoint = (ctx.metaEndpoint || META_ENDPOINT_DEFAULT).replace(/\/$/, '');
  const model = ctx.model || META_DEFAULT_MODEL;

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildPrompt(query, ctx.maxVariants) }],
      temperature: ctx.temperature,
      // 2000, not 200: Spark Contributor is a reasoning model — it spent ~660
      // of 2000 tokens on hidden reasoning in a live call, and this API nulls
      // content on length-finish instead of returning a partial. The cap must
      // fit reasoning + all variants. Latency follows: allow a generous
      // timeoutMs when Meta is primary (see plugin.jsonc example).
      max_tokens: 2000
    }),
    signal: AbortSignal.timeout(ctx.timeoutMs)
  });

  if (!res.ok) throw new Error(`Meta expansion failed: ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }>;
  };
  const choice = data.choices?.[0];
  const text = choice?.message?.content ?? '';
  const variants = parseVariants(text, ctx.maxVariants);
  // Null/empty content means the model spent the budget without answering.
  // finish_reason separates the two cases: 'length' = token limit hit,
  // anything else = genuinely no expansion. Both throw so expandQuery falls
  // back to the configured fallback provider; the message keeps them
  // distinguishable in logs.
  if (variants.length === 0) {
    if (choice?.finish_reason === 'length') {
      throw new Error('meta expansion truncated by token limit (finish_reason=length)');
    }
    throw new Error('meta expansion returned no variants');
  }
  return { variants, latencyMs: Date.now() - started, provider: `meta/${model}` };
}

async function callProvider(query: string, ctx: ProviderContext): Promise<ExpandedQueries> {
  switch (ctx.type) {
    case 'ollama':
      return expandViaOllama(query, ctx);
    case 'anthropic':
      return expandViaAnthropic(query, ctx);
    case 'bedrock':
      return expandViaBedrock(query, ctx);
    case 'meta':
      return expandViaMeta(query, ctx);
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
  const metaEndpoint = providers?.meta?.endpoint || META_ENDPOINT_DEFAULT;
  const metaApiKeyEnv = providers?.meta?.apiKeyEnv || META_API_KEY_ENV_DEFAULT;
  const metaApiKeyFile = providers?.meta?.apiKeyFile;
  const anthropicApiKeyFile = providers?.anthropic?.apiKeyFile;

  const primaryCtx: ProviderContext = {
    type: cfg.provider,
    model: cfg.model,
    ollamaEndpoint,
    bedrockRegion,
    metaEndpoint,
    metaApiKeyEnv,
    metaApiKeyFile,
    anthropicApiKeyFile,
    timeoutMs: cfg.timeoutMs,
    temperature: cfg.temperature,
    maxVariants: cfg.maxVariants
  };

  try {
    return await callProvider(query, primaryCtx);
  } catch (err) {
    // Fail-open stands (Core Principle 5 — expansion never blocks a prompt),
    // but a configured-but-broken key file is exactly the silent-demote case
    // the file-based key design explicitly called out: without surfacing
    // this, a bad path just looks identical to a transient timeout, and
    // whoever's demoing Meta would see Bedrock's output with no visible
    // reason why. Logged here (daemon.log, for `contextus watch`) AND
    // returned as `warning` so the daemon's /query handler can put it where
    // the model/user actually sees it — a log line alone isn't enough for a
    // live demo where nobody's tailing logs.
    const primaryWarning = keyFileWarningFrom(err);
    if (primaryWarning) console.error(`[contextus] expansion: ${primaryWarning} — falling back`);

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
            metaEndpoint,
            metaApiKeyEnv,
            metaApiKeyFile,
            anthropicApiKeyFile,
            timeoutMs: remaining,
            temperature: cfg.temperature,
            maxVariants: cfg.maxVariants
          };
          const result = await callProvider(query, fallbackCtx);
          // Fallback SUCCEEDED despite the primary's broken key file — still
          // surface that warning. Otherwise a working-looking result (real
          // variants, just from the wrong provider) hides exactly the
          // misconfiguration someone would want to know about mid-demo.
          return primaryWarning ? { ...result, warning: primaryWarning } : result;
        } catch (fallbackErr) {
          // Both failed — degrade gracefully, but still surface either
          // broken key file rather than letting it look identical to the
          // fallback simply timing out too.
          const fallbackWarning = keyFileWarningFrom(fallbackErr);
          if (fallbackWarning) {
            console.error(`[contextus] expansion fallback: ${fallbackWarning} — degrading`);
          }
          const warning = [primaryWarning, fallbackWarning].filter(Boolean).join('; ') || undefined;
          return { variants: [], latencyMs: Date.now() - started, provider: cfg.provider, warning };
        }
      }
    }
    return {
      variants: [],
      latencyMs: Date.now() - started,
      provider: cfg.provider,
      warning: primaryWarning
    };
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
