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
/** Linear-interpolated percentile of a sorted ascending array. */
export function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0)
        return 0;
    if (sortedAsc.length === 1)
        return sortedAsc[0];
    const idx = (p / 100) * (sortedAsc.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi)
        return sortedAsc[lo];
    const frac = idx - lo;
    return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}
/** Share of values ≥ floor (coverage). 0 for an empty set. */
export function coverage(values, floor) {
    if (values.length === 0)
        return 0;
    return values.filter((v) => v >= floor).length / values.length;
}
/** Fixed grid of candidate floors for the trade curve + coverage-target search. */
const FLOOR_GRID = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];
/**
 * Build a floor→injection-rate trade curve over a fixed grid of floors.
 */
export function buildCoverageCurve(top1s) {
    return FLOOR_GRID.map((floor) => ({ floor, injectionRate: coverage(top1s, floor) }));
}
/**
 * Pick the grid floor whose injection rate is closest to a coverage target — the
 * weak-separation fallback. Prefers the lowest floor that doesn't exceed the
 * target (slightly under-injecting beats over-injecting against "not every prompt
 * gets context"); if every floor over-injects, takes the highest (most selective).
 */
export function floorForCoverage(top1s, target) {
    let best = FLOOR_GRID[FLOOR_GRID.length - 1];
    let bestDelta = Infinity;
    for (const floor of FLOOR_GRID) {
        const rate = coverage(top1s, floor);
        // distance to target, with a small penalty for over-injecting past it
        const delta = Math.abs(rate - target) + (rate > target ? 0.0001 : 0);
        if (delta < bestDelta) {
            bestDelta = delta;
            best = floor;
        }
    }
    return best;
}
/**
 * A thin cluster of unusually-strong matches at the extreme top is a tail, NOT a
 * noise→signal boundary — anchoring the floor above it would inject for ~0% of
 * prompts, strictly worse than any reasonable floor (caught on the real corpus: a
 * lone 0.772 match drove the recommendation to 0.71 / 0% injection). So the gap
 * search excludes the top slice of the distribution.
 *
 * The exclusion is a FRACTION, not a fixed count, so it scales with sample size:
 * a fixed `2` is 0.7% of a 300-prompt replay but 4% of a 50-prompt one, and would
 * wrongly swallow a legitimate 3-pattern signal cluster on a small replay. We
 * exclude the top TAIL_FRACTION, with a floor of TAIL_MIN (you need at least one
 * sample held out for "above the gap" to mean anything) and a cap so we never eat
 * a real cluster on a large replay.
 */
const TAIL_FRACTION = 0.02;
const TAIL_MIN = 1;
const TAIL_MAX = 5;
/** How many top samples to hold out of the gap search for a given sample count. */
export function tailExclusion(n) {
    return Math.min(TAIL_MAX, Math.max(TAIL_MIN, Math.round(n * TAIL_FRACTION)));
}
/**
 * Below this median #1↔#2 separation the distribution has no real bimodal
 * noise/signal split (it's a smooth ramp). floor-calibration-signals documents
 * exactly this for ollama-nomic; the honest answer is a coverage TARGET, not a
 * discovered gap, until the v2 top-K + relative-separation gate replaces absolute
 * floors entirely.
 */
const WEAK_SEPARATION = 0.05;
/** When falling back to a coverage target, inject for roughly this share. */
const COVERAGE_TARGET = 0.35;
/**
 * Recommend a floor from replayed results.
 *
 * Two strategies, picked by the distribution's shape:
 *
 *  1. NATURAL GAP — when the upper half has a clear jump between the noise cloud
 *     (most prompts, low scores) and a genuine-match cluster, the floor belongs in
 *     that gap. This is the relative-separation insight from floor-calibration-
 *     signals applied at the corpus level. The search excludes a thin top slice
 *     (tailExclusion) so a lone strong outlier can't park the floor above all the
 *     good matches (the 0.772 → 0.71/0% misfire).
 *  2. COVERAGE TARGET — when separation is weak (a smooth ramp, no clean gap), no
 *     single absolute number cleanly separates signal from noise, so we instead
 *     recommend the floor that injects for ~COVERAGE_TARGET of prompts and say so
 *     plainly. This is honest about the limitation rather than inventing a gap.
 *
 * Output is always paired with a coverage curve so the human can override — the
 * exit criterion is "is this floor sane?", which only the user can answer against
 * their own corpus. The recommendation is a starting point, not a verdict.
 */
export function recommendFloor(results) {
    const top1s = results.map((r) => r.top1).filter((v) => v !== null);
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
            rationale: 'No prompts produced retrievable results (empty corpus?). Falling back to the permissive 0.35 default — recalibrate once the corpus is populated.',
        };
    }
    const sorted = [...top1s].sort((a, b) => a - b);
    const pct = {
        p10: percentile(sorted, 10),
        p25: percentile(sorted, 25),
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90),
    };
    const separations = results
        .filter((r) => r.top1 !== null && r.top2 !== null)
        .map((r) => r.top1 - r.top2)
        .sort((a, b) => a - b);
    const medianSeparation = separations.length ? percentile(separations, 50) : 0;
    // Find the widest gap between adjacent sorted scores in the UPPER half (≥p50),
    // EXCLUDING a thin top slice (tailExclusion, scaled to sample size) so an
    // extreme-tail of unusually strong matches can't anchor the floor above the bulk
    // of good matches. The floor would sit at the bottom of that gap.
    const upperStart = Math.max(1, Math.floor(sorted.length * 0.5));
    const gapSearchEnd = sorted.length - tailExclusion(sorted.length); // don't let the tail win
    let gapLo = pct.p75;
    let gapSize = 0;
    for (let i = upperStart; i < gapSearchEnd; i++) {
        const gap = sorted[i] - sorted[i - 1];
        if (gap > gapSize) {
            gapSize = gap;
            gapLo = sorted[i - 1];
        }
    }
    // Strategy pick: a real gap (≥0.05) on a distribution with non-trivial #1↔#2
    // separation → place the floor in the gap. Otherwise (weak separation / smooth
    // ramp) → recommend the floor that hits the coverage target, and be honest that
    // there's no discoverable boundary here.
    const hasGap = gapSize >= 0.05 && medianSeparation >= WEAK_SEPARATION;
    let recommendedFloor;
    if (hasGap) {
        const basis = gapLo + gapSize * 0.25; // nudge up into the gap
        recommendedFloor = Math.min(0.95, Math.max(0.05, Math.round(basis * 100) / 100));
    }
    else {
        recommendedFloor = floorForCoverage(top1s, COVERAGE_TARGET);
    }
    const coverageAtFloor = coverage(top1s, recommendedFloor);
    const coverageCurve = buildCoverageCurve(top1s);
    const rationale = hasGap
        ? `Placed in the widest gap (${gapSize.toFixed(3)} wide, starting at ${gapLo.toFixed(3)}) in the upper half of the top-1 distribution — the natural boundary between the noise cloud (most prompts, which have no real match in this corpus) and the genuine-match cluster. Injects for ~${Math.round(coverageAtFloor * 100)}% of prompts. NOT a recall-maximizing floor: a floor that injects on every prompt would violate "not every prompt gets context."`
        : `No clean noise/signal gap — the top-1 distribution is a smooth ramp (median #1↔#2 separation ${medianSeparation.toFixed(3)}, below ${WEAK_SEPARATION}), so no single absolute floor cleanly separates signal from noise. Recommended the floor that injects for ~${Math.round(coverageAtFloor * 100)}% of prompts (coverage target ${Math.round(COVERAGE_TARGET * 100)}%); eyeball the trade curve and pick your own rate. A v2 top-K + relative-separation gate will discriminate better than any absolute floor here (floor-calibration-signals).`;
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
//# sourceMappingURL=floor-calibration.js.map