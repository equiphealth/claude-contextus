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
import type { ContextRow } from './storage/lance-client.js';

export interface CorpusStats {
  /** total rows (chunks) in the table; 0 if no table yet */
  chunks: number;
  /** rows grouped by frontmatter type */
  byType: Record<string, number>;
  /** how many rows have been retrieved at least once */
  withHits: number;
  /** total retrievals across all rows (Σ hit_count) */
  totalHits: number;
  /** the most-retrieved rows, descending (id + count), capped */
  topHits: Array<{ id: string; hits: number }>;
}

export interface Introspection {
  version: string;
  uptimeSeconds: number;
  modelLoaded: boolean;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    /** provider/model that actually BUILT this project's corpus (from sidecar) */
    corpusProvider: string | null;
    corpusModel: string | null;
  };
  /** loaded source "packs" (DESIGN.md multi-source) — enabled config sources */
  packs: string[];
  corpus: CorpusStats;
  retrieval: {
    topK: number;
    injectionFloor: number;
    similarityThreshold: number;
    maxTokens: number;
  };
  rerankWeights: {
    typeBoosts: Record<string, number>;
    sourceWeights: Record<string, number>;
  };
  calibration: {
    evaluateUsage: boolean;
    sampleCount: number;
    targetSamples: number;
  };
}

const TOP_HITS = 5;

/** Read corpus stats from the table (or empty stats if no corpus yet). */
export async function corpusStats(project?: string): Promise<CorpusStats> {
  const empty: CorpusStats = { chunks: 0, byType: {}, withHits: 0, totalHits: 0, topHits: [] };
  if (!(await tableExists(project))) return empty;

  const table = await openTable(project);
  let query = table.query().select(['id', 'type', 'hit_count']);
  if (project) {
    query = query.where(`project = '${project.replace(/'/g, "''")}'`);
  }
  const rows = (await query.toArray()) as Array<Pick<ContextRow, 'id' | 'type' | 'hit_count'>>;

  const byType: Record<string, number> = {};
  let withHits = 0;
  let totalHits = 0;
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    const h = r.hit_count ?? 0;
    if (h > 0) withHits++;
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
function loadedPacks(): string[] {
  const names = loadedSourceNames();
  return names.length > 0 ? names : ['projectContext'];
}

/**
 * Build the full introspection payload. `version` and `uptimeSeconds` and
 * `modelLoaded` are passed in by the daemon (it owns process lifetime).
 */
export async function buildIntrospection(args: {
  version: string;
  uptimeSeconds: number;
  modelLoaded: boolean;
  project?: string;
}): Promise<Introspection> {
  const cfg = loadConfig();
  const meta = readTableMeta(args.project);
  const cal = readCalibrationState();
  const activeModel =
    cfg.embedding.provider === 'ollama' ? cfg.embedding.ollamaModel : cfg.embedding.model;

  return {
    version: args.version,
    uptimeSeconds: Math.round(args.uptimeSeconds),
    modelLoaded: args.modelLoaded,
    embedding: {
      provider: cfg.embedding.provider,
      model: activeModel,
      dimensions: cfg.embedding.dimensions,
      corpusProvider: meta?.provider ?? null,
      corpusModel: meta?.embeddingModel ?? null
    },
    packs: loadedPacks(),
    corpus: await corpusStats(args.project),
    retrieval: {
      topK: cfg.retrieval.topK,
      injectionFloor: cfg.retrieval.injectionFloor,
      similarityThreshold: cfg.retrieval.similarityThreshold,
      maxTokens: cfg.retrieval.maxTokens
    },
    rerankWeights: {
      typeBoosts: TYPE_BOOSTS,
      sourceWeights: SOURCE_WEIGHTS
    },
    calibration: {
      evaluateUsage: cal.evaluateUsage,
      sampleCount: cal.sampleCount,
      targetSamples: cal.targetSamples
    }
  };
}

/** Daemon-reported table name, exported for callers that want the constant. */
export { TABLE_NAME };
