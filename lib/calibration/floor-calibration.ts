/**
 * Floor calibration — pure stats over replayed prompts (Phase 5 brief).
 *
 * We replay real historical prompts through the retrieval pipeline and look at
 * the resulting similarity distribution to recommend an injection floor. The
 * hard truth (floor-calibration-signals memory): with no ground-truth labels for
 * which prompts SHOULD match, an absolute floor can't perfectly separate signal
 * from noise — the same off-topic doc swung -0.08→+0.39 on phrasing alone. So
 * this harness is deliberately honest about what it can and can't conclude:
 *
 *  - It reports the FULL top-1 distribution (percentiles) so the human can eyeball
 *    it — the exit criterion is "is the recommended floor sane?", a human call.
 *  - It surfaces the #1↔#2 separation, the signal the memory says actually
 *    discriminates, as supporting evidence (not the recommendation itself in v1).
 *  - Its recommendation is framed as coverage: "floor F injects for N% of prompts."
 *
 * No I/O here — the script (scripts/calibrate-floor.ts) feeds in the per-prompt
 * results. This split keeps the math unit-testable without embeddings.
 */

/** One replayed prompt's outcome: the top similarities its query produced. */
export interface ReplayResult {
  /** best (rank-1) raw similarity; null if the corpus returned nothing */
  top1: number | null;
  /** rank-2 raw similarity, if any (for separation analysis) */
  top2: number | null;
}

export interface Percentiles {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** One point on the floor→injection-rate trade curve. */
export interface CoveragePoint {
  floor: number;
  /** fraction of sampled prompts that would inject at this floor */
  injectionRate: number;
}

export interface FloorRecommendation {
  /** prompts replayed (with ≥1 retrievable row) */
  sampled: number;
  /** prompts whose corpus returned zero rows (excluded from the distribution) */
  emptyResults: number;
  /** distribution of rank-1 similarity across sampled prompts */
  top1Percentiles: Percentiles;
  /** min / max top-1 seen */
  top1Min: number;
  top1Max: number;
  /** median #1↔#2 gap — the relative-separation signal (diagnostic) */
  medianSeparation: number;
  /** the recommended floor */
  recommendedFloor: number;
  /** % of sampled prompts that WOULD inject at the recommended floor */
  coverageAtFloor: number;
  /** floor→injection-rate trade curve, so the human can pick a different point */
  coverageCurve: CoveragePoint[];
  /** plain-language basis for the recommendation */
  rationale: string;
}

/** Linear-interpolated percentile of a sorted ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const frac = idx - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

/** Share of values ≥ floor (coverage). 0 for an empty set. */
export function coverage(values: number[], floor: number): number {
  if (values.length === 0) return 0;
  return values.filter((v) => v >= floor).length / values.length;
}

/**
 * Build a floor→injection-rate trade curve over a fixed grid of floors.
 */
export function buildCoverageCurve(top1s: number[]): CoveragePoint[] {
  const grid = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
  return grid.map((floor) => ({ floor, injectionRate: coverage(top1s, floor) }));
}

/**
 * Recommend a floor from replayed results.
 *
 * The naive "floor below p10 → high recall" strategy is WRONG when most replayed
 * prompts have no real match in the corpus (the common case for a small/young
 * corpus): it drives the floor into the noise band and injects on everything,
 * violating DESIGN.md's "not every prompt should receive context." So instead we
 * find the NATURAL GAP — the widest jump between adjacent sorted top-1 scores in
 * the upper half of the distribution. That gap is the boundary between the noise
 * cloud (most prompts, low scores) and the genuine-match cluster (the tail), and
 * the floor belongs in it. This is the relative-separation insight from
 * floor-calibration-signals applied at the CORPUS level rather than per-prompt.
 *
 * Output is always paired with a coverage curve so the human can override — the
 * exit criterion is "is this floor sane?", which only the user can answer against
 * their own corpus. The recommendation is a starting point, not a verdict.
 */
export function recommendFloor(results: ReplayResult[]): FloorRecommendation {
  const top1s = results.map((r) => r.top1).filter((v): v is number => v !== null);
  const emptyResults = results.length - top1s.length;

  if (top1s.length === 0) {
    return {
      sampled: 0,
      emptyResults,
      top1Percentiles: { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
      top1Min: 0,
      top1Max: 0,
      medianSeparation: 0,
      recommendedFloor: 0.35,
      coverageAtFloor: 0,
      coverageCurve: [],
      rationale:
        'No prompts produced retrievable results (empty corpus?). Falling back to the permissive 0.35 default — recalibrate once the corpus is populated.',
    };
  }

  const sorted = [...top1s].sort((a, b) => a - b);
  const pct: Percentiles = {
    p10: percentile(sorted, 10),
    p25: percentile(sorted, 25),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
  };

  const separations = results
    .filter((r) => r.top1 !== null && r.top2 !== null)
    .map((r) => (r.top1 as number) - (r.top2 as number))
    .sort((a, b) => a - b);
  const medianSeparation = separations.length ? percentile(separations, 50) : 0;

  // Find the widest gap between adjacent sorted scores in the UPPER half (≥p50):
  // that's the noise→signal boundary. The floor sits at the bottom of the gap.
  const upperStart = Math.max(1, Math.floor(sorted.length * 0.5));
  let gapLo = pct.p75;
  let gapSize = 0;
  for (let i = upperStart; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > gapSize) {
      gapSize = gap;
      gapLo = sorted[i - 1];
    }
  }

  // Floor at the bottom of the gap, nudged up a touch into it, rounded to 2dp,
  // clamped. If the gap is trivial (a smooth distribution, no clear cluster),
  // fall back to p75 — inject for roughly the top quartile.
  const basis = gapSize >= 0.05 ? gapLo + gapSize * 0.25 : pct.p75;
  const recommendedFloor = Math.min(0.95, Math.max(0.05, Math.round(basis * 100) / 100));
  const coverageAtFloor = coverage(top1s, recommendedFloor);
  const coverageCurve = buildCoverageCurve(top1s);

  const rationale =
    gapSize >= 0.05
      ? `Placed in the widest gap (${gapSize.toFixed(3)} wide, starting at ${gapLo.toFixed(
          3
        )}) in the upper half of the top-1 distribution — the natural boundary between the noise cloud (most prompts, which have no real match in this corpus) and the genuine-match cluster. Injects for ~${Math.round(
          coverageAtFloor * 100
        )}% of prompts. NOT a recall-maximizing floor: most replayed prompts SHOULDN'T match a 3-file corpus, and a floor that injects on all of them would violate "not every prompt gets context."`
      : `No clear noise/signal gap in the distribution (smooth) — fell back to the 75th percentile, injecting for ~${Math.round(
          coverageAtFloor * 100
        )}% of prompts. Median #1↔#2 separation is ${medianSeparation.toFixed(
          3
        )}; if low, a v2 top-K + relative-separation gate will discriminate better than any absolute floor.`;

  return {
    sampled: top1s.length,
    emptyResults,
    top1Percentiles: pct,
    top1Min: sorted[0],
    top1Max: sorted[sorted.length - 1],
    medianSeparation,
    recommendedFloor,
    coverageAtFloor,
    coverageCurve,
    rationale,
  };
}
