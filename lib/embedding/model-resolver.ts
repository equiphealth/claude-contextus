/**
 * Model resolver — make the Transformers.js model source config-driven so a
 * blocked Hugging Face download is a config choice, not a dead end.
 *
 * Resolution order (cheapest/most-reliable first), all driven by
 * `config.embedding.transformers`:
 *   1. localModelPath — a pre-fetched bundle (`scripts/fetch-model.ts`). Tried
 *      before any network; the answer for HF-blocked or air-gapped networks.
 *   2. cacheDir — transformers.js FS cache (seeded or from a prior download).
 *   3. remoteHost — Hugging Face by default, or an internal mirror.
 * `allowRemoteModels: false` hard-disables the network (strict offline).
 *
 * Why this exists: the documented default (download nomic from HF on first run)
 * silently fails behind corporate proxies / Cloudflare Gateway — see the
 * embedding-download-risk memory + BUILD_LOG Phase 1. This module turns that
 * opaque `fetch failed` into either a working local path or an actionable error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { env } from '@xenova/transformers';
import { expandHome, loadProjectConfig, type TransformersConfig } from '../config.js';

let _configuredKey: string | null = null;
const defaultEnv = {
  localModelPath: env.localModelPath,
  allowLocalModels: env.allowLocalModels,
  cacheDir: env.cacheDir,
  remoteHost: env.remoteHost,
  useFSCache: env.useFSCache,
  useBrowserCache: env.useBrowserCache
};

/** Resolve the transformers config block with home-expansion applied. */
function tConfig(projectId?: string, cwd?: string): TransformersConfig {
  const t = loadProjectConfig(projectId, cwd).embedding.transformers!;
  return {
    localModelPath: t.localModelPath ? expandHome(t.localModelPath) : '',
    cacheDir: t.cacheDir ? expandHome(t.cacheDir) : '',
    remoteHost: t.remoteHost,
    allowRemoteModels: t.allowRemoteModels
  };
}

/**
 * Apply the resolver settings to the global transformers.js `env`. Idempotent —
 * call before the first pipeline() load (the embedder does this lazily).
 */
export function configureTransformersEnv(projectId?: string, cwd?: string): void {
  const t = tConfig(projectId, cwd);
  const key = JSON.stringify(t);
  if (_configuredKey === key) return;
  Object.assign(env, defaultEnv);

  if (t.localModelPath) {
    env.localModelPath = t.localModelPath;
    env.allowLocalModels = true;
    // transformers.js's getModelFile checks its filesystem/browser cache
    // BEFORE the localModelPath lookup — if an earlier attempt on a network
    // that blocks huggingface.co (corporate proxy, captive portal, Cloudflare
    // Gateway) cached a bad HTML block-page response, every subsequent load
    // silently serves that stale response instead of ever consulting the
    // bundle, even with allowRemoteModels:false. That's exactly the scenario
    // modelUnavailableError()'s own advice walks into: "pre-fetch a bundle on
    // an unblocked network, then point localModelPath at it" — which would
    // still fail with the same opaque HTML-parse error if a bad response was
    // already cached from the earlier blocked attempt. Disabling the caches
    // when a local bundle is configured makes localModelPath authoritative,
    // as documented. No cost here: a bundled/offline setup has no remote
    // downloads to cache in the first place.
    env.useFSCache = false;
    env.useBrowserCache = false;
  }
  if (t.cacheDir) env.cacheDir = t.cacheDir;
  if (t.remoteHost) env.remoteHost = t.remoteHost;
  env.allowRemoteModels = t.allowRemoteModels;

  _configuredKey = key;
}

/** True if a bundled model for `modelId` exists under localModelPath. */
export function hasLocalModel(modelId: string, projectId?: string, cwd?: string): boolean {
  const { localModelPath } = tConfig(projectId, cwd);
  if (!localModelPath) return false;
  // transformers.js looks for <localModelPath>/<modelId>/config.json
  return fs.existsSync(path.join(localModelPath, modelId, 'config.json'));
}

/** Probe whether the configured remote host is reachable for this model. */
export async function isRemoteReachable(
  modelId: string,
  timeoutMs = 5000,
  projectId?: string,
  cwd?: string
): Promise<boolean> {
  const { remoteHost } = tConfig(projectId, cwd);
  const url = `${remoteHost.replace(/\/$/, '')}/${modelId}/resolve/main/config.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return false;
    // A captive portal / gateway block returns 200 + HTML, not JSON — verify.
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) return false;
    await res.json();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the actionable error shown when the Transformers.js model can't be
 * sourced. Lists every escape hatch in priority order.
 */
export function modelUnavailableError(modelId: string, projectId?: string, cwd?: string): Error {
  const { localModelPath, remoteHost } = tConfig(projectId, cwd);
  return new Error(
    [
      `Could not load embedding model '${modelId}' via Transformers.js.`,
      `The model isn't bundled locally and ${remoteHost} is unreachable`,
      `(common on corporate networks that block Hugging Face — see the`,
      `embedding-download-risk memory). Fix with any of:`,
      ``,
      `  1. Use Ollama instead (no HF download):`,
      `       ollama pull nomic-embed-text`,
      `       …then set "provider": "ollama" in plugin.json`,
      `  2. Pre-fetch a bundle on an unblocked network, then point at it:`,
      `       pnpm fetch-model --out ./models`,
      `       …then set embedding.transformers.localModelPath: "${localModelPath || './models'}"`,
      `  3. Use an internal HF mirror:`,
      `       set embedding.transformers.remoteHost to your Artifactory/Nexus URL`,
      `  4. On a TLS-intercepting proxy, also export the corporate root:`,
      `       NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem`
    ].join('\n')
  );
}

/**
 * Pre-flight gate for the Transformers.js provider: ensure the model is sourceable
 * before a slow pipeline() call fails opaquely. Returns silently if a local bundle
 * exists or the remote is reachable; throws `modelUnavailableError` otherwise.
 * Skipped entirely when remote is allowed AND reachable, or a bundle is present.
 */
export async function preflightTransformers(
  modelId: string,
  projectId?: string,
  cwd?: string
): Promise<void> {
  if (hasLocalModel(modelId, projectId, cwd)) return;
  const { allowRemoteModels } = tConfig(projectId, cwd);
  if (allowRemoteModels && (await isRemoteReachable(modelId, 5000, projectId, cwd))) return;
  throw modelUnavailableError(modelId, projectId, cwd);
}

/** Reset memoized env state (tests). */
export function resetResolver(): void {
  _configuredKey = null;
}
