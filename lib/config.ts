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
  /**
   * Append the `Context: used: <file> (<score>)` provenance footer when context
   * injects? Default true. Some users only want the answer, not the retrieval
   * receipt — set false to suppress it. This gates ONLY the `used:` footer; the
   * `propose:` capture footer is load-bearing (it's how new patterns get saved)
   * and stays on, governed separately by `contextCapture.mode`. Per-project via
   * the config tiers, so one project can stay quiet without affecting others.
   */
  provenanceFooter: boolean;
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

/**
 * Calibration STATIC config (plugin.json). The mutable campaign state — the live
 * sample counter and enabled flip — lives in ~/.contextus/calibration-state.json
 * (lib/calibration-state.ts), never in the checked-in plugin.json.
 */
export interface CalibrationConfig {
  /** evaluations to collect per campaign before auto-disabling */
  targetSamples: number;
  /** which model judges usage (anthropic Haiku default, ollama opt-in) */
  model: { provider: 'anthropic' | 'ollama'; model?: string; endpoint?: string };
}

export interface ContextusConfig {
  embedding: EmbeddingConfig;
  storage: StorageConfig;
  retrieval: RetrievalConfig;
  notifications: NotificationsConfig;
  calibration: CalibrationConfig;
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
    provenanceFooter: true, // show "Context: used:" by default; opt-out per project
  },
  notifications: {
    verbosity: 'normal', // code default; deployed plugin.json sets 'verbose'
  },
  calibration: {
    targetSamples: 100, // LOGGING.md default sample budget per campaign
    model: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  },
};

let _config: ContextusConfig | null = null;
/** Per-project merged configs, keyed by project name. */
const _projectConfig = new Map<string, ContextusConfig>();

/** Locate plugin.json (repo root is one level up from lib/). */
function findPluginJson(): string | null {
  const candidate = path.resolve(__dirname, '..', 'plugin.json');
  return fs.existsSync(candidate) ? candidate : null;
}

/** Apply a raw `config` object (plugin.json or an override file) onto `merged`. */
function mergeConfigInto(merged: ContextusConfig, c: Record<string, any>): void {
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
  if (c.calibration) Object.assign(merged.calibration, c.calibration);
}

/** Read a JSON file's `config` object (or the whole file if no `config` key). [] on miss. */
function readConfigFile(filePath: string): Record<string, any> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // plugin.json nests under `config`; override files may be flat OR nested.
    return (raw.config ?? raw) as Record<string, any>;
  } catch {
    return null; // unparseable override is ignored, never fatal
  }
}

/**
 * Load merged GLOBAL config (plugin.json over defaults). Cached after first call.
 * Project-agnostic — use loadProjectConfig() when a project's overrides matter
 * (the daemon hot path). The 19 call sites that just need embedding/storage
 * defaults keep using this unchanged.
 */
export function loadConfig(): ContextusConfig {
  if (_config) return _config;
  const merged: ContextusConfig = structuredClone(DEFAULTS);
  const pluginPath = findPluginJson();
  if (pluginPath) {
    const c = readConfigFile(pluginPath);
    if (c) mergeConfigInto(merged, c);
  }
  _config = merged;
  return merged;
}

/**
 * Path to a project's machine-local override (tier 2) — next to its corpus DB.
 * `calibrate --apply` writes here; not version-controlled.
 */
export function projectLocalConfigPath(project: string): string {
  const base = expandHome('~/.contextus/data');
  return path.join(base, project, 'config.json');
}

/**
 * Load a PROJECT's merged config via the 3-tier precedence (later wins):
 *   1. global plugin.json (over DEFAULTS)        — ships with contextus
 *   2. ~/.contextus/data/<project>/config.json   — machine-local (calibrate --apply)
 *   3. <cwd>/.claude/contextus.json              — git-committed, team-shared (WINS)
 *
 * Cached per project. `cwd` (the project repo root) is needed for tier 3; omit it
 * and tier 3 is simply skipped. Falls back to global config when project is empty.
 */
export function loadProjectConfig(project?: string, cwd?: string): ContextusConfig {
  if (!project) return loadConfig();
  const cached = _projectConfig.get(project);
  if (cached) return cached;

  // Tier 1: start from the global merged config (defaults + plugin.json).
  const merged: ContextusConfig = structuredClone(loadConfig());
  // Tier 2: machine-local override beside the corpus.
  const local = readConfigFile(projectLocalConfigPath(project));
  if (local) mergeConfigInto(merged, local);
  // Tier 3: git-committed repo override wins.
  if (cwd) {
    const repo = readConfigFile(path.join(cwd, '.claude', 'contextus.json'));
    if (repo) mergeConfigInto(merged, repo);
  }

  _projectConfig.set(project, merged);
  return merged;
}

/** Clear caches (tests + after a config write so the next read re-merges). */
export function resetConfigCache(): void {
  _config = null;
  _projectConfig.clear();
}

/**
 * Names of enabled source "packs" from plugin.json `config.sources` (DESIGN.md
 * multi-source). Not part of the typed ContextusConfig (it's plugin-only ingest
 * wiring), so it's read directly here for /introspect. Returns [] if absent.
 */
export function loadedSourceNames(): string[] {
  const pluginPath = findPluginJson();
  if (!pluginPath) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
    const sources = raw.config?.sources as Record<string, { enabled?: boolean }> | undefined;
    if (!sources) return [];
    return Object.entries(sources)
      .filter(([, s]) => s?.enabled !== false)
      .map(([name]) => name);
  } catch {
    return [];
  }
}

/**
 * Return the raw plugin.json `config` object (untyped) for callers that need
 * config beyond the typed ContextusConfig — e.g. the multi-source `sources` map
 * the embed pipeline reads. Returns {} if plugin.json is missing/unparseable.
 */
export function findPluginConfig(): Record<string, unknown> {
  const pluginPath = findPluginJson();
  if (!pluginPath) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
    return (raw.config ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
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
