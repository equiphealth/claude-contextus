/**
 * Eval model call — the mockable boundary (Phase-5 brief: "test the parser, mock
 * the model call"). Dependency-free: both providers are raw `fetch`, mirroring
 * how lib/embedder's Ollama path already works. No @anthropic-ai/sdk dependency.
 *
 * Default is Haiku (ollama-model-quality: proven reliable, ~10× cheaper than
 * Sonnet, structured task well within its range). Ollama is the privacy/offline
 * opt-in — viable here because thinking blocks turn the task into "did Claude say
 * they used this?" rather than open-ended semantic judgement.
 */

/** Which model judges calibration usage. Mirrors the provider registry. */
export interface EvalModelConfig {
  provider: 'anthropic' | 'ollama' | 'bedrock' | 'meta';
  /** model id/tag; sensible per-provider default applied if omitted */
  model?: string;
  /** ollama endpoint (resolved from providers.ollama.endpoint if omitted) */
  endpoint?: string;
  /** bedrock region (resolved from providers.bedrock.region if omitted) */
  region?: string;
  /** Meta API base URL (resolved from providers.meta.endpoint if omitted) */
  metaEndpoint?: string;
  /** env var holding the Meta key (resolved from providers.meta.apiKeyEnv if omitted) */
  metaApiKeyEnv?: string;
  /** max output tokens (default: 256 for calibration, higher for extraction) */
  maxTokens?: number;
}

/** Meta Model API defaults, local like the Haiku id below (this file stays dependency-free). */
const META_ENDPOINT_DEFAULT = 'https://api.meta.ai/v1';
const META_KEY_ENV_DEFAULT = 'META_API_KEY';
const META_KEY_ENV_FALLBACK = 'MODEL_API_KEY';
const META_MODEL_DEFAULT = 'muse-spark-1.3-contributor';

export const DEFAULT_EVAL_MODEL: EvalModelConfig = {
  provider: 'bedrock',
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
};

/** Injected so tests run the worker end-to-end without a network call. */
export type EvalCaller = (prompt: string, cfg: EvalModelConfig) => Promise<string>;

/** Anthropic Messages API over raw fetch. Returns the reply text (unparsed). */
async function callAnthropic(prompt: string, cfg: EvalModelConfig): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set (required for anthropic eval provider)');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: cfg.model ?? DEFAULT_EVAL_MODEL.model,
      max_tokens: cfg.maxTokens ?? 256,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) {
    throw new Error(`anthropic eval failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? '';
}

/** Ollama generate API over raw fetch (privacy/offline opt-in). */
async function callOllama(prompt: string, cfg: EvalModelConfig): Promise<string> {
  const endpoint = cfg.endpoint ?? 'http://localhost:11434';
  const res = await fetch(`${endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: cfg.model ?? 'llama3.1:8b', prompt, stream: false }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!res.ok) throw new Error(`ollama eval failed: ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? '';
}

/** AWS Bedrock InvokeModel via SDK (uses default credential chain). */
async function callBedrock(prompt: string, cfg: EvalModelConfig): Promise<string> {
  const { BedrockRuntimeClient, InvokeModelCommand } =
    await import('@aws-sdk/client-bedrock-runtime');
  const client = new BedrockRuntimeClient({ region: cfg.region ?? 'us-east-1' });
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: cfg.maxTokens ?? 256,
    messages: [{ role: 'user', content: prompt }]
  });
  const command = new InvokeModelCommand({
    modelId: cfg.model ?? DEFAULT_EVAL_MODEL.model,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body)
  });
  const response = await client.send(command, { requestTimeout: 30_000 });
  const result = JSON.parse(new TextDecoder().decode(response.body)) as {
    content?: Array<{ text?: string }>;
  };
  return result.content?.[0]?.text ?? '';
}

/**
 * Meta Model API over raw fetch (OpenAI-compatible chat completions).
 * Same contract status as expansion: third-party-documented wire shape
 * (verified live for expansion on muse-spark-1.3-contributor), fail-open
 * on missing key or API error. Note the cap: Spark Contributor is a
 * reasoning model, so grading calls need headroom (256 is not enough).
 */
async function callMeta(prompt: string, cfg: EvalModelConfig): Promise<string> {
  const apiKey =
    process.env[cfg.metaApiKeyEnv || META_KEY_ENV_DEFAULT] || process.env[META_KEY_ENV_FALLBACK];
  if (!apiKey) {
    throw new Error(
      `Meta eval needs a key: set ${cfg.metaApiKeyEnv || META_KEY_ENV_DEFAULT} (or ${META_KEY_ENV_FALLBACK})`
    );
  }
  const endpoint = (cfg.metaEndpoint || META_ENDPOINT_DEFAULT).replace(/\/$/, '');
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: cfg.model ?? META_MODEL_DEFAULT,
      max_tokens: cfg.maxTokens ?? 2000,
      messages: [{ role: 'user', content: prompt }]
    }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!res.ok) {
    throw new Error(`meta eval failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Dispatch to the configured provider. This is what the worker mocks in tests. */
export const callEvalModel: EvalCaller = (prompt, cfg) => {
  switch (cfg.provider) {
    case 'anthropic':
      return callAnthropic(prompt, cfg);
    case 'ollama':
      return callOllama(prompt, cfg);
    case 'bedrock':
      return callBedrock(prompt, cfg);
    case 'meta':
      return callMeta(prompt, cfg);
    default:
      return Promise.reject(
        new Error(`unknown eval provider: ${(cfg as EvalModelConfig).provider}`)
      );
  }
};
