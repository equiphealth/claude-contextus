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
/** Hard defaults — embedding locked to Transformers.js + nomic. */
const DEFAULTS = {
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
let _config = null;
/** Per-project merged configs, keyed by project name. */
const _projectConfig = new Map();
/**
 * Locate plugin.json across all three layouts. The `..`-from-lib assumption broke
 * once the daemon ran COMPILED: as `dist/lib/config.js`, `..` is `dist/` (no
 * plugin.json) → silent fallback to DEFAULTS (wrong provider). So resolve robustly:
 *   1. $CLAUDE_PLUGIN_ROOT/plugin.json  — the packaged/installed plugin (authoritative)
 *   2. walk up from this module's dir   — covers dev (lib/) AND built (dist/lib/)
 * Returns null only if no plugin.json exists anywhere up the tree (true standalone).
 */
function findPluginJson() {
    const fromEnv = process.env.CLAUDE_PLUGIN_ROOT
        ? path.join(process.env.CLAUDE_PLUGIN_ROOT, 'plugin.json')
        : null;
    if (fromEnv && fs.existsSync(fromEnv))
        return fromEnv;
    // Walk up from __dirname until we find a plugin.json (handles lib/ and dist/lib/).
    let dir = __dirname;
    for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, 'plugin.json');
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break; // hit filesystem root
        dir = parent;
    }
    return null;
}
/** Apply a raw `config` object (plugin.json or an override file) onto `merged`. */
function mergeConfigInto(merged, c) {
    if (c.embedding) {
        // Deep-merge the nested `transformers` object so a partial override
        // (e.g. just localModelPath) doesn't wipe the other defaults.
        const { transformers: tOverride, ...eRest } = c.embedding;
        Object.assign(merged.embedding, eRest);
        if (tOverride)
            Object.assign(merged.embedding.transformers, tOverride);
    }
    if (c.lancedb?.path)
        merged.storage.path = c.lancedb.path;
    if (c.retrieval)
        Object.assign(merged.retrieval, c.retrieval);
    if (c.notifications)
        Object.assign(merged.notifications, c.notifications);
    if (c.calibration)
        Object.assign(merged.calibration, c.calibration);
}
/** Read a JSON file's `config` object (or the whole file if no `config` key). [] on miss. */
function readConfigFile(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return null;
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // plugin.json nests under `config`; override files may be flat OR nested.
        return (raw.config ?? raw);
    }
    catch {
        return null; // unparseable override is ignored, never fatal
    }
}
/**
 * Load merged GLOBAL config (plugin.json over defaults). Cached after first call.
 * Project-agnostic — use loadProjectConfig() when a project's overrides matter
 * (the daemon hot path). The 19 call sites that just need embedding/storage
 * defaults keep using this unchanged.
 */
export function loadConfig() {
    if (_config)
        return _config;
    const merged = structuredClone(DEFAULTS);
    const pluginPath = findPluginJson();
    if (pluginPath) {
        const c = readConfigFile(pluginPath);
        if (c)
            mergeConfigInto(merged, c);
    }
    _config = merged;
    return merged;
}
/**
 * Path to a project's machine-local override (tier 2) — next to its corpus DB.
 * `calibrate --apply` writes here; not version-controlled.
 */
export function projectLocalConfigPath(project) {
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
export function loadProjectConfig(project, cwd) {
    if (!project)
        return loadConfig();
    const cached = _projectConfig.get(project);
    if (cached)
        return cached;
    // Tier 1: start from the global merged config (defaults + plugin.json).
    const merged = structuredClone(loadConfig());
    // Tier 2: machine-local override beside the corpus.
    const local = readConfigFile(projectLocalConfigPath(project));
    if (local)
        mergeConfigInto(merged, local);
    // Tier 3: git-committed repo override wins.
    if (cwd) {
        const repo = readConfigFile(path.join(cwd, '.claude', 'contextus.json'));
        if (repo)
            mergeConfigInto(merged, repo);
    }
    _projectConfig.set(project, merged);
    return merged;
}
/** Clear caches (tests + after a config write so the next read re-merges). */
export function resetConfigCache() {
    _config = null;
    _projectConfig.clear();
}
/**
 * Names of enabled source "packs" from plugin.json `config.sources` (DESIGN.md
 * multi-source). Not part of the typed ContextusConfig (it's plugin-only ingest
 * wiring), so it's read directly here for /introspect. Returns [] if absent.
 */
export function loadedSourceNames() {
    const pluginPath = findPluginJson();
    if (!pluginPath)
        return [];
    try {
        const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
        const sources = raw.config?.sources;
        if (!sources)
            return [];
        return Object.entries(sources)
            .filter(([, s]) => s?.enabled !== false)
            .map(([name]) => name);
    }
    catch {
        return [];
    }
}
/**
 * Return the raw plugin.json `config` object (untyped) for callers that need
 * config beyond the typed ContextusConfig — e.g. the multi-source `sources` map
 * the embed pipeline reads. Returns {} if plugin.json is missing/unparseable.
 */
export function findPluginConfig() {
    const pluginPath = findPluginJson();
    if (!pluginPath)
        return {};
    try {
        const raw = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
        return (raw.config ?? {});
    }
    catch {
        return {};
    }
}
/** Expand a leading `~` to the user's home directory. */
export function expandHome(p) {
    if (!p.startsWith('~'))
        return p;
    return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', p.slice(1));
}
/**
 * Resolve the on-disk DB directory for a project, expanding `~` and
 * `{project-name}`.
 */
export function resolveDBPath(projectName) {
    const { storage } = loadConfig();
    const name = projectName ?? path.basename(process.cwd());
    const p = expandHome(storage.path.replace('{project-name}', name));
    return path.resolve(p);
}
//# sourceMappingURL=config.js.map