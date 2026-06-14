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

/** Which model judges calibration usage. Mirrors the embedding provider split. */
export interface EvalModelConfig {
  provider: 'anthropic' | 'ollama';
  /** model id/tag; sensible per-provider default applied if omitted */
  model?: string;
  /** ollama endpoint (ignored for anthropic) */
  endpoint?: string;
}

export const DEFAULT_EVAL_MODEL: EvalModelConfig = {
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
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
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.model ?? DEFAULT_EVAL_MODEL.model,
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ollama eval failed: ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? '';
}

/** Dispatch to the configured provider. This is what the worker mocks in tests. */
export const callEvalModel: EvalCaller = (prompt, cfg) => {
  switch (cfg.provider) {
    case 'anthropic':
      return callAnthropic(prompt, cfg);
    case 'ollama':
      return callOllama(prompt, cfg);
    default:
      return Promise.reject(
        new Error(`unknown eval provider: ${(cfg as EvalModelConfig).provider}`)
      );
  }
};
