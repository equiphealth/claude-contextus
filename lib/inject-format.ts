/**
 * Injection formatter — render kept chunks as a user-message prepend block.
 *
 * Format follows the injection-format decision (user-message prepend + bracketed
 * framing): front-loaded for primacy, bracketed so Claude can tell retrieved
 * resources from the user's own words, "reference if relevant" (not "must use").
 * The block is returned as `additionalContext`; the harness prepends it to the
 * user's prompt.
 *
 * Token budget (config.retrieval.maxTokens, default 3k): we add chunks in
 * re-ranked order until the next one would blow the budget, then stop. A chunk
 * dropped for budget is distinct from one dropped by the floor — the caller logs
 * it separately. Token count is the standard ~4-chars-per-token estimate (no
 * tokenizer dependency in the hot path; off by <10% for English prose).
 */

import type { RankedResult } from './reranker.js';

/** Bracketed header (sets framing: these are retrieved resources, use if useful). */
const HEADER = "[Retrieved from your project's context patterns — reference these if relevant]";

/** Cheap token estimate: ~4 chars/token for English. Good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** One chunk's rendered block: title + similarity/hits line + body. */
function renderChunk(r: RankedResult): string {
  const hits = r.hit_count > 0 ? `, used ${r.hit_count}×` : '';
  const title = r.filename || r.id;
  return `**${title}** (similarity: ${r.similarity.toFixed(2)}${hits})\n${r.document.trim()}`;
}

/** Result of formatting: the block plus what was included vs. budget-trimmed. */
export interface FormatResult {
  /** the full injection block, or '' if nothing fit */
  block: string;
  /** chunks actually included in the block */
  included: RankedResult[];
  /** chunks dropped because the token budget was exhausted (not the floor) */
  budgetDropped: RankedResult[];
  /** estimated tokens of the rendered block */
  tokens: number;
}

/**
 * Build the injection block from floor-passing chunks, greedily within
 * `maxTokens`. The header is always counted; at least the top chunk is included
 * even if it alone exceeds budget (better a truncating-but-present top hit than
 * silent nothing — the floor already decided it's relevant).
 */
export function formatInjection(kept: RankedResult[], maxTokens: number): FormatResult {
  if (kept.length === 0) {
    return { block: '', included: [], budgetDropped: [], tokens: 0 };
  }

  const included: RankedResult[] = [];
  const budgetDropped: RankedResult[] = [];
  let used = estimateTokens(HEADER);

  for (const r of kept) {
    const rendered = renderChunk(r);
    const cost = estimateTokens(rendered) + 2; // +2 for the "\n\n" separator
    // Always admit the first chunk; otherwise respect the budget.
    if (included.length > 0 && used + cost > maxTokens) {
      budgetDropped.push(r);
      continue;
    }
    included.push(r);
    used += cost;
  }

  const body = included.map(renderChunk).join('\n\n');
  const block = `${HEADER}\n\n${body}`;
  return { block, included, budgetDropped, tokens: estimateTokens(block) };
}
