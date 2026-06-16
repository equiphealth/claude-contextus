/**
 * Introspection — Self-documentation Layer 1, minimal (SELF_DOCUMENTATION.md;
 * IMPLEMENTATION_ESTIMATE Phase 5). One endpoint that reports the daemon's live
 * configuration + corpus stats, so /context-status reads real numbers instead of
 * the hard-coded mock in its SKILL.md.
 *
 * Deferred to v2 (per the design table): `generate-docs` and the 7 auto-doc
 * files. This is the read-only runtime view only.
 */
import { loadConfig, loadedSourceNames } from './config.js';
import { TABLE_NAME, openTable, tableExists, readTableMeta } from './storage/lance-client.js';
import { SOURCE_WEIGHTS, TYPE_BOOSTS } from './retrieval/reranker.js';
import { readState as readCalibrationState } from './calibration/calibration-state.js';
const TOP_HITS = 5;
/** Read corpus stats from the table (or empty stats if no corpus yet). */
export async function corpusStats(project) {
    const empty = { chunks: 0, byType: {}, withHits: 0, totalHits: 0, topHits: [] };
    if (!(await tableExists(project)))
        return empty;
    const table = await openTable(project);
    const rows = (await table.query().select(['id', 'type', 'hit_count']).toArray());
    const byType = {};
    let withHits = 0;
    let totalHits = 0;
    for (const r of rows) {
        byType[r.type] = (byType[r.type] ?? 0) + 1;
        const h = r.hit_count ?? 0;
        if (h > 0)
            withHits++;
        totalHits += h;
    }
    const topHits = rows
        .filter((r) => (r.hit_count ?? 0) > 0)
        .sort((a, b) => (b.hit_count ?? 0) - (a.hit_count ?? 0))
        .slice(0, TOP_HITS)
        .map((r) => ({ id: r.id, hits: r.hit_count ?? 0 }));
    return { chunks: rows.length, byType, withHits, totalHits, topHits };
}
/** Enabled source packs from plugin.json config.sources, or a sensible default. */
function loadedPacks() {
    const names = loadedSourceNames();
    return names.length > 0 ? names : ['projectContext'];
}
/**
 * Build the full introspection payload. `version` and `uptimeSeconds` and
 * `modelLoaded` are passed in by the daemon (it owns process lifetime).
 */
export async function buildIntrospection(args) {
    const cfg = loadConfig();
    const meta = readTableMeta(args.project);
    const cal = readCalibrationState();
    const activeModel = cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model;
    return {
        version: args.version,
        uptimeSeconds: Math.round(args.uptimeSeconds),
        modelLoaded: args.modelLoaded,
        embedding: {
            provider: cfg.embedding.provider,
            model: activeModel,
            dimensions: cfg.embedding.dimensions,
            corpusProvider: meta?.provider ?? null,
            corpusModel: meta?.embeddingModel ?? null,
        },
        packs: loadedPacks(),
        corpus: await corpusStats(args.project),
        retrieval: {
            topK: cfg.retrieval.topK,
            injectionFloor: cfg.retrieval.injectionFloor,
            similarityThreshold: cfg.retrieval.similarityThreshold,
            maxTokens: cfg.retrieval.maxTokens,
        },
        rerankWeights: {
            typeBoosts: TYPE_BOOSTS,
            sourceWeights: SOURCE_WEIGHTS,
        },
        calibration: {
            evaluateUsage: cal.evaluateUsage,
            sampleCount: cal.sampleCount,
            targetSamples: cal.targetSamples,
        },
    };
}
/** Daemon-reported table name, exported for callers that want the constant. */
export { TABLE_NAME };
//# sourceMappingURL=introspect.js.map