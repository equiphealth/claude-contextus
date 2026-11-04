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
import {
  loadTemplate,
  renderTemplate,
  type PatternVars,
  type TemplateContext
} from './template.js';

/**
 * Bracketed header — kept terse (it's paid on every injection). Two jobs in five
 * words: (1) ATTRIBUTION — the `contextus` tag so the block is unmistakable in a
 * session where several injectors (claude-mem, lean-ctx, reminder hooks) all add
 * "context"; without it an instance can misattribute another system's scores to
 * contextus (observed in Phase-2 verification — floor-calibration-signals memory).
 * (2) framing — "context", so it reads as a resource to use if relevant, not user
 * words. The `[contextus —` prefix is load-bearing (tests + the CLAUDE.md stanza
 * reference the `[contextus — …]` shape); keep it when editing the wording.
 */
const HEADER = '[contextus — relevant project context]';

/** Cheap token estimate: ~4 chars/token for English. Good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** One chunk's rendered block: title + heading + similarity/hits line + body. */
function renderChunk(r: RankedResult): string {
  const hits = r.hit_count > 0 ? `, used ${r.hit_count}×` : '';
  const title = r.filename || r.id;
  // A chunked file may surface a specific section — name it so the reader knows
  // this is an excerpt, not the whole file.
  const section = r.heading ? ` › ${r.heading}` : '';
  return `**${title}${section}** (similarity: ${r.similarity.toFixed(2)}${hits})\n${r.document.trim()}`;
}

/**
 * Truthful provenance-footer instruction, scoped to EXACTLY the injected files.
 *
 * Why this lives here (with the real data) and not in the awareness hook: the
 * awareness hook doesn't know what was injected, so instructing Claude there to
 * write "Context: used: <file>" induced HALLUCINATION — Claude invented a
 * plausible filename + score to satisfy the instruction when nothing had injected
 * (observed in a real session, 2026-06-15). The fix: the instruction can only
 * exist when injection did, and it WHITELISTS the exact name(s)+score(s), so Claude
 * reports ground truth rather than reciting from memory.
 */
export function renderFooterInstruction(included: RankedResult[]): string {
  if (included.length === 0) return '';
  const items = included
    .map((r) => `${r.filename || r.id} (${r.similarity.toFixed(2)})`)
    .join(', ');
  return (
    `\n\n[contextus footer] If you used any of the above, end your response with exactly: ` +
    `"Context: used: <file> (<score>)" using ONLY these — ${items}. ` +
    `List only the ones you actually relied on; if you used none, omit the footer. ` +
    `Never write a filename or score not in this list.`
  );
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

/** Result of fitting a rendered block to a host byte ceiling. */
export interface FitResult {
  /** the block to inject (byte-identical to the unfit block when under the ceiling) */
  block: string;
  /** chunks kept in full */
  included: RankedResult[];
  /** chunks replaced by one-line references */
  dropped: RankedResult[];
  /** whether any chunk was replaced */
  truncated: boolean;
}

/**
 * Intelligent host-ceiling fit (Muse support edge seam).
 *
 * Never splits a chunk mid-line (survivors re-render atomically through
 * formatInjection) and never touches the header, the fallback notice, or the
 * provenance footer — those stay intact always. Drops lowest-ranked chunks
 * first (finalScore, falling back to similarity), replacing each with a
 * one-line reference (path + section + score) so the model knows it exists
 * and can retrieve it via /context-search. The marker names the dropped
 * count and every dropped path.
 *
 * Under the ceiling this is the identity function (byte-identical output), so
 * callers without the cap see today's behavior bit-for-bit. Edge case only:
 * normal injection is ~12KB under the 16384-byte cap; this fires above it.
 */
export function fitBlockToCeiling(opts: {
  /** floor-passing chunks, any order (ranked internally, never mutated) */
  kept: RankedResult[];
  maxTokens: number;
  cwd?: string;
  fallbackNotice: boolean;
  provenanceFooter: boolean;
  /** byte ceiling; when <= 0 the block is returned unchanged */
  byteCeiling: number;
}): FitResult {
  const { kept, maxTokens, cwd, fallbackNotice, provenanceFooter, byteCeiling } = opts;

  const notice = fallbackNotice
    ? '\n\n[contextus notice] Results above are from keyword fallback (embedding provider was unreachable). Relevance may be lower than normal semantic search.'
    : '';
  const parts = (chunks: RankedResult[]) => {
    const { block: rawBlock, included } = formatInjection(chunks, maxTokens, cwd);
    const footer = provenanceFooter ? renderFooterInstruction(included) : '';
    return { head: rawBlock + notice, footer, included };
  };
  const renderRefs = (list: RankedResult[]): string =>
    list
      .map(
        (r) =>
          `- ${(r.filename || r.id) + (r.heading ? ` › ${r.heading}` : '')} (${r.similarity.toFixed(2)})`
      )
      .join('\n');
  const markerFor = (dropped: RankedResult[]): string =>
    `\n\n[contextus: truncated — dropped ${dropped.length} chunk(s) to fit the ${byteCeiling}-byte host limit: ` +
    `${dropped.map((r) => r.filename || r.id).join(', ')}. ` +
    `References below; retrieve full text via /context-search if needed.]\n` +
    renderRefs(dropped);

  // Fast path: under the ceiling the output is byte-identical to today.
  {
    const { head, footer, included } = parts(kept);
    if (byteCeiling <= 0 || Buffer.byteLength(head + footer, 'utf8') <= byteCeiling) {
      return { block: head + footer, included, dropped: [], truncated: false };
    }
  }

  // Lowest-ranked first. Defensive sort: rank must not depend on input order.
  const ranked = [...kept].sort(
    (a, b) => (b.finalScore ?? b.similarity) - (a.finalScore ?? a.similarity)
  );
  const dropped: RankedResult[] = [];
  const remaining = [...ranked];
  while (remaining.length > 0) {
    const lowest = remaining.pop();
    if (lowest === undefined) break;
    dropped.unshift(lowest);
    const { head, footer, included } = parts(remaining);
    const candidate = head + markerFor(dropped) + footer;
    if (Buffer.byteLength(candidate, 'utf8') <= byteCeiling) {
      return { block: candidate, included, dropped, truncated: true };
    }
  }

  // Pathological: even the header alone exceeds the ceiling (or every chunk
  // was dropped). Emit refs + marker without full chunks — never a blind cut.
  const { head, footer, included } = parts([]);
  return { block: head + markerFor(dropped) + footer, included, dropped, truncated: true };
}

/**
 * Build the injection block from floor-passing chunks, greedily within
 * `maxTokens`. The header is always counted; at least the top chunk is included
 * even if it alone exceeds budget (better a truncating-but-present top hit than
 * silent nothing — the floor already decided it's relevant).
 *
 * When a template file exists (.claude/contextus-template.md or
 * ~/.contextus/contextus-template.md), renders through it instead of the
 * hardcoded format. The token budget still applies — we admit chunks greedily
 * using the legacy renderChunk estimate, then render all admitted chunks
 * through the template.
 */
export function formatInjection(
  kept: RankedResult[],
  maxTokens: number,
  cwd?: string
): FormatResult {
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

  // Render through user template if one exists, otherwise use hardcoded format.
  const template = loadTemplate(cwd);
  const block = renderWithTemplate(template, included);
  return { block, included, budgetDropped, tokens: estimateTokens(block) };
}

/** Render included chunks through the template system. */
function renderWithTemplate(template: string, included: RankedResult[]): string {
  const patterns: PatternVars[] = included.map((r) => ({
    filename: r.filename || r.id,
    heading: r.heading || '',
    body: r.document.trim(),
    similarity: r.similarity.toFixed(2),
    hits: r.hit_count,
    type: r.type || '',
    source: r.source || ''
  }));

  const ctx: TemplateContext = { count: included.length, patterns };
  return renderTemplate(template, ctx);
}
