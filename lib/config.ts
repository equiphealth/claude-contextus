/**
 * Config — single source of truth for embedding + storage settings.
 *
 * Values are read from plugin.json `config` (the installed-plugin config),
 * with hard defaults here so the daemon/scripts work standalone in-repo.
 *
 * Embedding is LOCKED to Transformers.js + nomic by default (DESIGN.md):
 * the model id is config-driven, NOT hardcoded at call sites.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Where embeddings are computed. Both run nomic locally. */
export type EmbeddingProvider = 'transformers' | 'ollama';

export interface EmbeddingConfig {
  /**
   * Provider. Code default is 'transformers' (DESIGN.md canonical), but the
   * deployed plugin.json may override to 'ollama' — e.g. when a corporate proxy
   * blocks Hugging Face model downloads (see BUILD_LOG Phase 1). Whichever built
   * the corpus is recorded in the table sidecar and must match at query time.
   */
  provider: EmbeddingProvider;
  /** Transformers.js model id (HF repo). Default: nomic-embed-text-v1.5 */
  model: string;
  /** Ollama model tag (used when provider === 'ollama'). */
  ollamaModel: string;
  /** Ollama HTTP endpoint. */
  ollamaEndpoint: string;
  /** Vector dimensions the model emits. nomic → 768 (both providers) */
  dimensions: number;
  /** Embedding batch size */
  batchSize: number;
}

export interface StorageConfig {
  /** file mode only in v1 */
  mode: 'file';
  /** dir path; {project-name} placeholder resolved at runtime */
  path: string;
}

export interface RetrievalConfig {
  topK: number;
  /** UNVALIDATED floor — see DESIGN.md "Validate during POC". Measure the
   *  real similarity distribution before trusting 0.7. */
  similarityThreshold: number;
  maxTokens: number;
  mergeStrategy: 'interleaved' | 'prioritize-context' | 'prioritize-docs';
}

export interface ContextusConfig {
  embedding: EmbeddingConfig;
  storage: StorageConfig;
  retrieval: RetrievalConfig;
}

/** Hard defaults — embedding locked to Transformers.js + nomic. */
const DEFAULTS: ContextusConfig = {
  embedding: {
    provider: 'transformers',
    model: 'nomic-ai/nomic-embed-text-v1.5',
    ollamaModel: 'nomic-embed-text',
    ollamaEndpoint: 'http://localhost:11434',
    dimensions: 768,
    batchSize: 32,
  },
  storage: {
    mode: 'file',
    path: '~/.contextus/data/{project-name}',
  },
  retrieval: {
    topK: 5,
    similarityThreshold: 0.7, // UNVALIDATED — calibrate in Phase 5
    maxTokens: 3000,
    mergeStrategy: 'interleaved',
  },
};

let _config: ContextusConfig | null = null;

/** Locate plugin.json (repo root is one level up from lib/). */
function findPluginJson(): string | null {
  const candidate = path.resolve(__dirname, '..', 'plugin.json');
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Load merged config (plugin.json overrides defaults). Cached after first call.
 */
export function loadConfig(): ContextusConfig {
  if (_config) return _config;

  const merged: ContextusConfig = structuredClone(DEFAULTS);
  const pluginPath = findPluginJson();

  if (pluginPath) {
    try {
      const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
      const c = raw.config ?? {};
      if (c.embedding) Object.assign(merged.embedding, c.embedding);
      if (c.lancedb?.path) merged.storage.path = c.lancedb.path;
      if (c.retrieval) Object.assign(merged.retrieval, c.retrieval);
    } catch {
      /* fall back to defaults on any parse error */
    }
  }

  _config = merged;
  return merged;
}

/**
 * Resolve the on-disk DB directory for a project, expanding `~` and
 * `{project-name}`.
 */
export function resolveDBPath(projectName?: string): string {
  const { storage } = loadConfig();
  const name = projectName ?? path.basename(process.cwd());
  let p = storage.path.replace('{project-name}', name);
  if (p.startsWith('~')) {
    p = path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(1));
  }
  return path.resolve(p);
}
