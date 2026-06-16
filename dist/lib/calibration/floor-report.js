/**
 * Floor-report renderer — pretty-prints a floor-replay outcome (distribution +
 * trade curve + recommendation) to stdout.
 *
 * Lives in lib/ (not in a script) so BOTH entry points can import it without
 * pulling in a script's side-effecting `main()`: scripts/calibrate-floor.ts (the
 * dev CLI) and scripts/context-calibrate.ts (the --floor front door) share this.
 * Importing an entry-point file would run its main() as a side effect — the same
 * "don't import an entry point" hazard as the hook-files-esm-and-smoke-test memory.
 */
function bar(value, max, width = 24) {
    const n = max <= 0 ? 0 : Math.round((value / max) * width);
    return '█'.repeat(n) + '·'.repeat(Math.max(0, width - n));
}
/** Render the full floor-replay report to stdout. */
export function printFloorReport(outcome, currentFloor) {
    const rec = outcome.recommendation;
    const p = rec.top1Percentiles;
    const maxP = p.p90;
    console.log('\n══════════════════════════════════════════════════════════');
    console.log('  Floor Calibration — top-1 similarity distribution');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  prompts replayed:   ${rec.sampled}  (empty results: ${rec.emptyResults})`);
    console.log(`  top-1 range:        ${rec.top1Min.toFixed(3)} … ${rec.top1Max.toFixed(3)}`);
    console.log('');
    console.log(`  p10  ${p.p10.toFixed(3)}  ${bar(p.p10, maxP)}`);
    console.log(`  p25  ${p.p25.toFixed(3)}  ${bar(p.p25, maxP)}`);
    console.log(`  p50  ${p.p50.toFixed(3)}  ${bar(p.p50, maxP)}  (median)`);
    console.log(`  p75  ${p.p75.toFixed(3)}  ${bar(p.p75, maxP)}`);
    console.log(`  p90  ${p.p90.toFixed(3)}  ${bar(p.p90, maxP)}`);
    console.log('');
    console.log(`  median #1↔#2 separation: ${rec.medianSeparation.toFixed(3)}`);
    console.log('');
    console.log('  floor → injection-rate trade curve:');
    for (const c of rec.coverageCurve) {
        const mark = Math.abs(c.floor - rec.recommendedFloor) < 0.001 ? ' ←recommended' : '';
        console.log(`    ${c.floor.toFixed(2)}  ${bar(c.injectionRate, 1, 20)}  ${Math.round(c.injectionRate * 100)}%${mark}`);
    }
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  RECOMMENDED FLOOR:  ${rec.recommendedFloor.toFixed(2)}`);
    console.log(`  coverage at floor:  ${Math.round(rec.coverageAtFloor * 100)}% of prompts inject`);
    console.log(`  current floor:      ${currentFloor} (plugin.json)`);
    console.log('──────────────────────────────────────────────────────────');
    console.log(`  ${rec.rationale}`);
    console.log('');
}
//# sourceMappingURL=floor-report.js.map