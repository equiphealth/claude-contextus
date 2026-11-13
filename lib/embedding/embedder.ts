/**
 * Embedder — local text embedding, provider-abstracted.
 *
 * Two providers, both running nomic-embed-text (768-dim) entirely locally:
 *   - 'transformers' — @xenova/transformers, in-process ONNX (DESIGN.md default).
 *   - 'ollama'       — POST to a local Ollama server (DESIGN.md "Embedding
 *                      Providers" §Ollama). Used when Hugging Face downloads are
 *                      unreachable (e.g. corporate proxy block — see BUILD_LOG
 *                      Phase 1).
 * The provider is config-driven (lib/config.ts); the model id is NEVER hardcoded
 * here. Whichever provider builds the corpus is recorded in the table sidecar so
 * the daemon can fail fast on a build-vs-query mismatch.
 *
 * Pooling/normalization: mean pooling + L2 normalize, so cosine similarity is a
 * plain dot product and `similarity = 1 - distance` holds in lance-client. Ollama
 * does not return normalized vectors, so we normalize its output ourselves.
 *
 * nomic TASK PREFIXES: nomic-embed-text was trained with instruction prefixes —
 * `search_document:` for stored passages, `search_query:` for the query at
 * retrieval time (asymmetric retrieval, the model author's documented usage).
 * Applied by default via `embedDocument` / `embedQuery` so the two sides can't
 * drift. Set `CONTEXTUS_NOMIC_PREFIXES=0` to disable (A/B, or non-nomic models).
 */

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { loadConfig, loadProjectConfig, type ContextusConfig } from '../config.js';
import {
  configureTransformersEnv,
  modelUnavailableError,
  preflightTransformers
} from './model-resolver.js';

/** nomic instruction prefixes (asymmetric retrieval). */
export const DOCUMENT_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';

export interface EmbeddingContext {
  projectId?: string;
  cwd?: string;
}

export interface EmbeddingContextSnapshot extends EmbeddingContext {
  config: ContextusConfig;
}

type EmbeddingContextInput = EmbeddingContext | EmbeddingContextSnapshot;

function contextConfig(context?: EmbeddingContextInput): ContextusConfig {
  return context && 'config' in context
    ? context.config
    : loadProjectConfig(context?.projectId, context?.cwd);
}

function embeddingConfig(context?: EmbeddingContext | EmbeddingContextSnapshot) {
  const project = contextConfig(context).embedding;
  const shared = loadConfig().embedding;
  return {
    ...project,
    provider: shared.provider,
    model: shared.model,
    ollamaModel: shared.ollamaModel,
    dimensions: shared.dimensions
  };
}

export function snapshotEmbeddingContext(
  context?: EmbeddingContextInput
): EmbeddingContextSnapshot {
  return {
    ...context,
    config: structuredClone(contextConfig(context))
  };
}

/** Fail before persistence when a provider emits vectors outside the configured space. */
export function assertEmbeddingDimensions(
  vectors: readonly number[][],
  expectedDimensions: number
): void {
  const mismatch = vectors.find((vector) => vector.length !== expectedDimensions);
  if (mismatch) {
    throw new Error(
      `Embedding provider returned a vector with unexpected dimensions (${mismatch.length}; expected ${expectedDimensions})`
    );
  }
}

/** Whether to apply nomic task prefixes (default on; off via env for A/B). */
function prefixesEnabled(): boolean {
  return process.env.CONTEXTUS_NOMIC_PREFIXES !== '0';
}

/** L2-normalize a vector in place and return it (no-op if zero vector). */
function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/* ── Test-only fake provider ──────────────────────────────────────────────── */

/**
 * Deterministic, L2-normalized pseudo-vector derived from the input text's
 * hash — same shape as a real embedding (so downstream dimension checks and
 * cosine-similarity math don't need to know the difference), but with no
 * semantic meaning whatsoever. ONLY for CONTEXTUS_TEST_FAKE_EMBED=1.
 */
function fakeDeterministicVector(text: string, dims: number): number[] {
  // Simple string hash (FNV-1a-ish) seeds a linear congruential generator —
  // just needs to be deterministic and spread out, not cryptographically
  // anything.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let seed = h >>> 0;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0xffffffff;
  };
  const v = Array.from({ length: dims }, () => next() * 2 - 1);
  return l2normalize(v);
}

/**
 * CI has neither Ollama (no service started) nor a reliable Transformers.js
 * download available (see tests/integration/reconcile-multi-source.test.ts's
 * header) — so integration tests that need embedSingleFile's REAL
 * chunking/staleness/LanceDB wiring to run (not just a pure function in
 * isolation) set this to bypass only the actual model call, keeping
 * everything else genuine. NEVER set outside tests — every embedded file
 * would get an unrelated random vector, silently destroying retrieval
 * quality with no error.
 */
function fakeEmbedEnabled(): boolean {
  return process.env.CONTEXTUS_TEST_FAKE_EMBED === '1';
}

/* ── Transformers.js provider ─────────────────────────────────────────────── */

let _pipe: Promise<FeatureExtractionPipeline> | null = null;
let _pipeModel: string | null = null;
let _pipelineLoadQueue: Promise<void> = Promise.resolve();

function getPipeline(context?: EmbeddingContextInput): Promise<FeatureExtractionPipeline> {
  const { model, transformers } = embeddingConfig(context);
  const key = JSON.stringify([model, transformers]);
  if (!_pipe || _pipeModel !== key) {
    _pipeModel = key;
    // Apply localModelPath / cacheDir / remoteHost before the first load so a
    // bundled or mirrored model is sourced correctly (see lib/model-resolver).
    const loading = _pipelineLoadQueue.then(() => {
      configureTransformersEnv(transformers);
      return pipeline('feature-extraction', model, { quantized: true });
    });
    _pipelineLoadQueue = loading.then(
      () => undefined,
      () => undefined
    );
    _pipe = loading.catch((err: unknown) => {
      if (_pipeModel === key) _pipe = null;
      // Network/HF failures surface as opaque fetch/parse errors — replace with
      // the actionable escape-hatch message.
      const msg = err instanceof Error ? err.message : String(err);
      if (/fetch|JSON|Unexpected token|ENOTFOUND|ECONNREFUSED|certificate/i.test(msg)) {
        throw modelUnavailableError(model, transformers);
      }
      throw err;
    });
  }
  return _pipe;
}

async function embedTransformers(text: string, context?: EmbeddingContextInput): Promise<number[]> {
  const pipe = await getPipeline(context);
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

/* ── Ollama provider ──────────────────────────────────────────────────────── */

interface OllamaEmbeddingResponse {
  embedding: number[];
}

async function embedOllama(text: string, context?: EmbeddingContextInput): Promise<number[]> {
  const cfg = embeddingConfig(context);
  const { ollamaModel } = cfg;
  const ollamaEndpoint = cfg.ollamaEndpoint || contextConfig(context).providers.ollama.endpoint;
  const res = await fetch(`${ollamaEndpoint}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, prompt: text })
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as OllamaEmbeddingResponse;
  if (!Array.isArray(json.embedding)) {
    throw new Error('Ollama response missing `embedding` array');
  }
  // Ollama returns un-normalized vectors — normalize so cosine == dot product.
  return l2normalize(json.embedding);
}

/* ── Public API (provider-dispatching) ────────────────────────────────────── */

/** Embed text exactly as given (no prefix). Mean-pooled + L2-normalized. */
async function embedRaw(text: string, context?: EmbeddingContextInput): Promise<number[]> {
  const { provider, dimensions } = embeddingConfig(context);
  if (fakeEmbedEnabled()) return fakeDeterministicVector(text, dimensions);
  return provider === 'ollama' ? embedOllama(text, context) : embedTransformers(text, context);
}

/**
 * Warm-load the active provider and verify it emits the configured dimensions.
 * Call at daemon start so the first real query isn't slow — and so a
 * model/dimension mismatch fails fast (DESIGN.md §"dimensions must match").
 */
export async function warmup(context?: EmbeddingContextInput): Promise<void> {
  const { dimensions, provider, model, ollamaModel } = embeddingConfig(context);
  // Transformers.js: fail fast with an actionable message if the model is
  // neither bundled nor reachable, instead of a slow opaque pipeline() error.
  // Skipped under the fake-embed test seam — there's no real model to preflight.
  if (provider === 'transformers' && !fakeEmbedEnabled())
    await preflightTransformers(model, embeddingConfig(context).transformers);
  const vec = await embedRaw('warmup', context);
  if (vec.length !== dimensions) {
    const id = provider === 'ollama' ? ollamaModel : model;
    throw new Error(
      `Embedding dimension mismatch: ${provider} model '${id}' emitted ${vec.length} dims, ` +
        `config expects ${dimensions}. Fix config.embedding.dimensions or the model.`
    );
  }
}

/** Embed a single stored passage (document side — `search_document:` prefix). */
export function embedDocument(text: string, context?: EmbeddingContextInput): Promise<number[]> {
  return embedRaw(prefixesEnabled() ? DOCUMENT_PREFIX + text : text, context);
}

/** Embed a single query (query side — `search_query:` prefix). */
export function embedQuery(text: string, context?: EmbeddingContextInput): Promise<number[]> {
  return embedRaw(prefixesEnabled() ? QUERY_PREFIX + text : text, context);
}

/**
 * Embed many passages (document side). Sequential — both providers do one
 * inference at a time, so Promise.all would only thrash. `onProgress` reports
 * (done, total) for CLI progress.
 */
export async function embedDocuments(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
  context?: EmbeddingContextInput
): Promise<number[][]> {
  const snapshot = snapshotEmbeddingContext(context);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    out.push(await embedDocument(texts[i], snapshot));
    onProgress?.(i + 1, texts.length);
  }
  return out;
}

/** Cosine similarity of two L2-normalized vectors (= dot product). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Embeddings must have same dimension (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Reset the memoized pipeline (tests / model swap). */
export function resetEmbedder(): void {
  _pipe = null;
  _pipeModel = null;
}
