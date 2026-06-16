/**
 * Phase-0 verification: prove the real @lancedb/lancedb API matches what
 * lib/lance-client.ts assumes. Uses SYNTHETIC vectors (no model download) so
 * this isolates the LanceDB API risk from the Transformers.js pipeline.
 *
 * Run: pnpm exec tsx scripts/verify-lance.ts
 *
 * Exit criteria (DESIGN.md Phase 0): connects, creates a table, round-trips one
 * record. We also exercise upsert + filtered search since the daemon depends on
 * them, and confirm the provenance sidecar (LanceDB has no collection metadata).
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { createTable, upsertRows, search, countRows, readTableMeta, resetConnection, } from '../lib/storage/lance-client.js';
// Route the DB to a throwaway temp dir for this verification run.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contextus-verify-'));
process.env.HOME = tmp; // resolveDBPath expands ~ → tmp
const PROJECT = 'verify';
const DIM = 768;
function vec(seed) {
    // deterministic pseudo-vector; no Math.random needed
    return Array.from({ length: DIM }, (_, i) => Math.sin(seed * 0.1 + i * 0.01));
}
function assert(cond, msg) {
    if (!cond)
        throw new Error(`FAIL: ${msg}`);
    console.log(`  ✓ ${msg}`);
}
async function main() {
    console.log(`\n📍 LanceDB round-trip verification (DB at ${tmp})\n`);
    const row = {
        id: 'decisions/decision-foo.md',
        vector: vec(1),
        document: '# Foo\nAlways use the Logger helper for errors.',
        filename: 'decisions/decision-foo.md',
        chunk_index: 0,
        heading: '',
        type: 'decision',
        source: 'projectContext',
        tags: 'logging,errors',
        hit_count: 0,
        last_hit: '',
        updated_at: '2026-06-14T00:00:00.000Z',
        content_hash: 'deadbeef',
    };
    console.log('1. connect + createTable + single record');
    await createTable([row], { projectName: PROJECT, replace: true });
    assert((await countRows(PROJECT)) === 1, 'table has 1 row after create');
    console.log('2. provenance sidecar (no native collection metadata)');
    const meta = readTableMeta(PROJECT);
    assert(meta !== null, 'meta sidecar written');
    assert(meta.dimensions === DIM, `meta dimensions = ${DIM}`);
    assert(meta.embeddingModel.includes('nomic'), `meta embeddingModel locked to nomic (${meta.embeddingModel})`);
    console.log('3. vector search round-trips the record');
    const hits = await search(vec(1), 5, undefined, PROJECT);
    assert(hits.length === 1, 'search returns the row');
    assert(hits[0].id === row.id, 'round-tripped id matches');
    assert(hits[0].document === row.document, 'round-tripped document matches');
    assert(typeof hits[0].distance === 'number', '_distance present');
    assert(hits[0].similarity > 0.99, `self-similarity ≈ 1 (got ${hits[0].similarity.toFixed(4)})`);
    console.log('4. upsert: update existing + insert new');
    await upsertRows([
        { ...row, hit_count: 7 }, // update existing id
        {
            ...row,
            id: 'design/design-bar.md',
            vector: vec(99),
            filename: 'design/design-bar.md',
            type: 'design',
        }, // new id
    ], PROJECT);
    assert((await countRows(PROJECT)) === 2, 'upsert inserted exactly one new row');
    const updated = await search(vec(1), 1, undefined, PROJECT);
    assert(updated[0].hit_count === 7, 'upsert updated existing row in place');
    console.log('5. filtered search (SQL predicate)');
    const filtered = await search(vec(99), 5, "type = 'design'", PROJECT);
    assert(filtered.length === 1 && filtered[0].type === 'design', 'where filter applies');
    resetConnection();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('\n✅ Phase 0 round-trip PASSED — lib/lance-client.ts matches the real API.\n');
}
main().catch((err) => {
    console.error('\n❌ Verification failed:', err.message);
    process.exitCode = 1;
});
//# sourceMappingURL=verify-lance.js.map