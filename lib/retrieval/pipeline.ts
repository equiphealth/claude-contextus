/**
 * Retrieval pipeline — the post-search core extracted from handleQuery for
 * testability. Takes raw search results and produces the injection payload
 * (or a near-miss notice, or nothing). All scoring decisions live here, so
 * integration tests can pass synthetic results with controlled similarity
 * scores and verify the full rerank→floor→miss-notice→format path.
 */

import type { SearchResult } from '../storage/lance-client.js';
import type { RankedResult } from './reranker.js';
import { rerank } from './reranker.js';
import { dedupe, collapseByFile } from './dedup.js';
import { applyFloor } from './floor.js';
import {
  formatInjection,
  renderFooterInstruction,
  fitBlockToCeiling,
  estimateTokens
} from './inject-format.js';
import { buildRetrievalMissNotice, isNearMiss, extractNearTopics } from './miss-notice.js';
import type { DroppedChunkLog } from '../logger.js';

export interface PipelineConfig {
  topK: number;
  injectionFloor: number;
  maxTokens: number;
  provenanceFooter: boolean;
  /**
   * Optional host byte ceiling (Muse edge seam). When set, the assembled
   * block is fit intelligently (chunk-drop with references, §fitBlockToCeiling)
   * instead of going out whole. When unset, assembly is exactly today's.
   */
  byteCeiling?: number;
}

export type PipelineOutcome =
  | {
      kind: 'inject';
      block: string;
      included: RankedResult[];
      tokens: number;
      floorDropped: DroppedChunkLog[];
    }
  | { kind: 'near-miss'; notice: string; bestScore: number; floorDropped: DroppedChunkLog[] }
  | { kind: 'no-inject'; bestScore: number; floorDropped: DroppedChunkLog[] };

/**
 * Run the retrieval pipeline: rerank → collapse → topK → dedupe → floor →
 * format (or near-miss notice). Pure function of its inputs — no I/O, no
 * state, fully deterministic given the same search results.
 */
export function processSearchResults(
  raw: SearchResult[],
  config: PipelineConfig,
  opts?: { cwd?: string; usedKeywordFallback?: boolean }
): PipelineOutcome {
  const ranked = rerank(raw);
  const byFile = collapseByFile(ranked).slice(0, config.topK);
  const { kept: deduped } = dedupe(byFile);
  const { kept, dropped, bestScore, noInject } = applyFloor(deduped, config.injectionFloor);

  const floorDropped: DroppedChunkLog[] = dropped.map((d) => ({
    pattern: d.filename || d.id,
    similarity: Number(d.similarity.toFixed(4))
  }));

  if (noInject) {
    if (isNearMiss(bestScore, floorDropped.length)) {
      const nearTopics = extractNearTopics(floorDropped);
      const notice = buildRetrievalMissNotice(bestScore, config.injectionFloor, nearTopics);
      return { kind: 'near-miss', notice, bestScore, floorDropped };
    }
    return { kind: 'no-inject', bestScore, floorDropped };
  }

  const { block: rawBlock, included, tokens } = formatInjection(kept, config.maxTokens, opts?.cwd);
  const fallbackNotice = opts?.usedKeywordFallback
    ? '\n\n[contextus notice] Results above are from keyword fallback (embedding provider was unreachable). Relevance may be lower than normal semantic search.'
    : '';
  const footer = config.provenanceFooter ? renderFooterInstruction(included) : '';
  const block = rawBlock + fallbackNotice + footer;

  if (config.byteCeiling && config.byteCeiling > 0) {
    const fit = fitBlockToCeiling({
      kept,
      maxTokens: config.maxTokens,
      cwd: opts?.cwd,
      fallbackNotice: !!opts?.usedKeywordFallback,
      provenanceFooter: config.provenanceFooter,
      byteCeiling: config.byteCeiling
    });
    return {
      kind: 'inject',
      block: fit.block,
      included: fit.included,
      tokens: estimateTokens(fit.block),
      floorDropped
    };
  }

  return { kind: 'inject', block, included, tokens, floorDropped };
}
