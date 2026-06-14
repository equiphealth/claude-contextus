/**
 * Calibration evaluation — pure logic (DESIGN.md §"Calibration", LOGGING.md
 * "Calibration Evaluation Event").
 *
 * This module is the *testable* heart of the eval worker: it builds the eval
 * prompt, parses the model's `number:rating` reply, and computes the weighted
 * quality score. The model call itself (lib/eval-model.ts) is the mockable
 * boundary — per the Phase-5 brief, we test the parser and mock the model.
 *
 * The honest-metrics premise (opus-metrics-critique): "tokens saved" measures
 * compression, not value. This score measures whether injected patterns were
 * actually USED — graded from Claude's own thinking + response as evidence,
 * which is why even a small model can judge it ("did Claude say they used this?"
 * not "is this semantically relevant?" — see ollama-model-quality).
 */

/** Rating → weight (LOGGING.md). critical=essential … unused=irrelevant. */
export const RATING_WEIGHTS = {
  critical: 1.0,
  helpful: 0.7,
  mentioned: 0.3,
  unused: 0.0,
} as const;

export type Rating = keyof typeof RATING_WEIGHTS;

/** An injected pattern as carried into evaluation (id + a short snippet). */
export interface InjectedPattern {
  id: string;
  snippet: string;
}

/** One pattern's graded rating, mapped back from the reply's 1-based index. */
export interface PatternRating {
  pattern: string;
  rating: Rating;
}

const RATING_RE = /(\d+)\s*:\s*(critical|helpful|mentioned|unused)/gi;

/**
 * Build the evaluation prompt the eval model answers. Numbered pattern list so
 * the model can reply in the compact `index:rating` form (LOGGING.md example).
 */
export function buildEvalPrompt(
  prompt: string,
  thinking: string,
  response: string,
  patterns: InjectedPattern[]
): string {
  const list = patterns.map((p, i) => `${i + 1}. ${p.id}: ${p.snippet}`).join('\n');
  return `User prompt: ${prompt}

Context patterns injected:
${list}

Claude's thinking: ${thinking || '(none captured)'}

Claude's response: ${response}

Of the context patterns injected above, which did Claude actually use, and how helpful was each? Reply ONLY with comma-separated "number:rating" pairs.

Ratings:
- critical: Essential to the response, answer would be wrong/incomplete without it
- helpful: Improved the answer, provided useful detail
- mentioned: Referenced but not central to the response
- unused: Injected but not relevant

Example: "1:critical, 3:helpful, 4:mentioned, 2:unused, 5:unused"`;
}

/**
 * Parse a `number:rating` reply into pattern-keyed ratings. Tolerant of prose
 * around the pairs, varied spacing, and case. Out-of-range indices are dropped;
 * a repeated index keeps the LAST rating seen (model self-correction wins).
 */
export function parseEvalResponse(text: string, patterns: InjectedPattern[]): PatternRating[] {
  if (!text) return [];
  // index (0-based) → rating; later matches overwrite earlier (last wins).
  const byIndex = new Map<number, Rating>();
  for (const m of text.matchAll(RATING_RE)) {
    const idx = parseInt(m[1], 10) - 1;
    if (idx < 0 || idx >= patterns.length) continue;
    byIndex.set(idx, m[2].toLowerCase() as Rating);
  }
  // Preserve pattern order for stable output.
  const out: PatternRating[] = [];
  for (let i = 0; i < patterns.length; i++) {
    const rating = byIndex.get(i);
    if (rating) out.push({ pattern: patterns[i].id, rating });
  }
  return out;
}

/**
 * Weighted quality score (LOGGING.md formula):
 *
 *   (Σ rating weights) / total_retrieved
 *
 * Note the denominator is the number of patterns RETRIEVED, not the number
 * rated — an unrated pattern counts as unused (weight 0). This is deliberate:
 * injecting something the model never grades is itself a quality cost.
 */
export function weightedScore(ratings: PatternRating[], totalRetrieved: number): number {
  if (totalRetrieved <= 0) return 0;
  const sum = ratings.reduce((acc, r) => acc + RATING_WEIGHTS[r.rating], 0);
  return sum / totalRetrieved;
}
