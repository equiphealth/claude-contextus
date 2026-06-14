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
  /**
   * Transformers.js model sourcing (ignored when provider === 'ollama'). The
   * resolver (lib/model-resolver.ts) tries, in order: a bundled/local dir →
   * the FS cache → a configured mirror → Hugging Face. This is the answer to
   * "HF is blocked" — point `localModelPath` at a pre-fetched bundle (see
   * `scripts/fetch-model.ts`) and it works fully offline.
   */
  transformers?: TransformersConfig;
}

export interface TransformersConfig {
  /**
   * Directory holding a pre-downloaded model in transformers.js layout
   * (`<dir>/<modelId>/<files>`). Tried before any network. Use to ship/seed a
   * model on networks that block Hugging Face. '' (default) = none.
   */
  localModelPath: string;
  /** FS cache dir for downloaded models. '' = transformers.js default (~/.cache). */
  cacheDir: string;
  /**
   * Host to download from when not found locally. Defaults to Hugging Face;
   * point at an internal Artifactory/Nexus mirror on gated networks.
   */
  remoteHost: string;
  /** Allow network downloads at all. Set false for strict offline/air-gapped. */
  allowRemoteModels: boolean;
}

export interface StorageConfig {
  /** file mode only in v1 */
  mode: 'file';
  /** dir path; {project-name} placeholder resolved at runtime */
  path: string;
}

export interface RetrievalConfig {
  topK: number;
  /** UNVALIDATED ranking filter — see DESIGN.md "Validate during POC". A quality
   *  filter AFTER ranking, NOT the retrieval gate. Tuned independently of the
   *  injection floor below; do not share a value (DESIGN.md §"Floor vs ranking"). */
  similarityThreshold: number;
  /**
   * Injection floor on RAW similarity — "inject anything at all?" (DESIGN.md
   * §"Injection Floor"). SEPARATE from similarityThreshold by design.
   *
   * ⚠ UNVALIDATED — Phase 5's replay harness sets the real value. Default 0.35 is
   * deliberately permissive because Phase-1 measurement (floor-calibration-signals
   * memory) found ollama-nomic puts CORRECT hits at 0.45–0.68 with noise ~0.0–0.09;
   * DESIGN.md's placeholder 0.7 would inject nothing. 0.35 clears the noise band
   * while admitting real matches so the spine demonstrably injects. NOT a tuned
   * value — calibrate before trusting.
   */
  injectionFloor: number;
  maxTokens: number;
  mergeStrategy: 'interleaved' | 'prioritize-context' | 'prioritize-docs';
}

/** SessionStart daemon-state message verbosity (user-facing systemMessage). */
export type NotificationVerbosity = 'silent' | 'normal' | 'verbose';

export interface NotificationsConfig {
  /**
   * silent  — never emit a daemon-state message
   * normal  — only noteworthy events (fresh spawn, still-warming, failure)
   * verbose — also a heartbeat with uptime when an existing daemon is found
   * Overridable per-session via the CONTEXTUS_VERBOSITY env var. The hooks read
   * this from plugin.json directly (plain JS can't import this module); kept here
   * so the type + default are single-sourced and available to the daemon.
   */
  verbosity: NotificationVerbosity;
}

export interface ContextusConfig {
  embedding: EmbeddingConfig;
  storage: StorageConfig;
  retrieval: RetrievalConfig;
  notifications: NotificationsConfig;
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
    transformers: {
      localModelPath: '',
      cacheDir: '',
      remoteHost: 'https://huggingface.co/',
      allowRemoteModels: true,
    },
  },
  storage: {
    mode: 'file',
    path: '~/.contextus/data/{project-name}',
  },
  retrieval: {
    topK: 5,
    similarityThreshold: 0.7, // UNVALIDATED ranking filter — calibrate in Phase 5
    injectionFloor: 0.35, // UNVALIDATED permissive gate — calibrate in Phase 5
    maxTokens: 3000,
    mergeStrategy: 'interleaved',
  },
  notifications: {
    verbosity: 'normal', // code default; deployed plugin.json sets 'verbose'
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
      if (c.embedding) {
        // Deep-merge the nested `transformers` object so a partial override
        // (e.g. just localModelPath) doesn't wipe the other defaults.
        const { transformers: tOverride, ...eRest } = c.embedding;
        Object.assign(merged.embedding, eRest);
        if (tOverride) Object.assign(merged.embedding.transformers!, tOverride);
      }
      if (c.lancedb?.path) merged.storage.path = c.lancedb.path;
      if (c.retrieval) Object.assign(merged.retrieval, c.retrieval);
      if (c.notifications) Object.assign(merged.notifications, c.notifications);
    } catch {
      /* fall back to defaults on any parse error */
    }
  }

  _config = merged;
  return merged;
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (!p.startsWith('~')) return p;
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(1));
}

/**
 * Resolve the on-disk DB directory for a project, expanding `~` and
 * `{project-name}`.
 */
export function resolveDBPath(projectName?: string): string {
  const { storage } = loadConfig();
  const name = projectName ?? path.basename(process.cwd());
  const p = expandHome(storage.path.replace('{project-name}', name));
  return path.resolve(p);
}
