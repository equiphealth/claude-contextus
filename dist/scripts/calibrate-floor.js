#!/usr/bin/env node
/**
 * Floor-calibration harness (Phase 5 exit criterion) — the dev/debug entry point.
 *
 * Replays REAL historical prompts — the user's own typed prompts, mined from the
 * Claude Code transcript JSONL files — through the exact query-side retrieval path
 * the daemon uses (embedQuery → search), then reports the similarity distribution
 * and recommends an injection floor. The replay engine lives in
 * lib/calibration/floor-replay.ts so the user-facing `/context-calibrate --floor`
 * runs identical logic (calibration-two-signals memory).
 *
 * This CLI PRINTS but never writes config — applying is the job of
 * `/context-calibrate --floor --apply`. The recommendation is a STARTING POINT
 * for human eyeball; the brief is explicit that the user judges whether the
 * number is sane before adopting it.
 *
 * Usage:
 *   pnpm calibrate-floor                      # this project's transcripts
 *   pnpm calibrate-floor --project automation # another project's transcripts
 *   pnpm calibrate-floor --limit 100          # cap prompts (default: all)
 *   pnpm calibrate-floor --json               # machine-readable output
 */
import path from 'path';
import { loadConfig } from '../lib/config.js';
import { runFloorReplay, ReplayError, } from '../lib/calibration/floor-replay.js';
import { printFloorReport } from '../lib/calibration/floor-report.js';
function parseArgs(argv) {
    let project = path.basename(process.cwd());
    let limit = Infinity;
    let json = false;
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--project' && argv[i + 1])
            project = argv[++i];
        else if (argv[i] === '--limit' && argv[i + 1])
            limit = Number(argv[++i]);
        else if (argv[i] === '--json')
            json = true;
    }
    return { project, limit, json };
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const cfg = loadConfig();
    let outcome;
    try {
        outcome = await runFloorReplay({ project: args.project, limit: args.limit }, args.json ? undefined : (msg) => console.error(msg));
    }
    catch (err) {
        if (err instanceof ReplayError) {
            console.error(err.message);
            process.exit(1);
        }
        throw err;
    }
    if (args.json) {
        console.log(JSON.stringify({ project: outcome.project, prompts: outcome.prompts, ...outcome.recommendation }, null, 2));
        return;
    }
    printFloorReport(outcome, cfg.retrieval.injectionFloor);
    console.log('  This is a recommendation for you to eyeball — NOT auto-applied.');
    console.log('  To apply: /context-calibrate --floor --apply (or set it in plugin.json).');
    console.log('══════════════════════════════════════════════════════════\n');
}
main().catch((err) => {
    console.error('calibrate-floor failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
//# sourceMappingURL=calibrate-floor.js.map