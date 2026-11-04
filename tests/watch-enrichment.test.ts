/**
 * Watch enrichment regression tests — usage.jsonl join, grouped view,
 * synthetic-project filter, and variant attribution display.
 *
 * Covers the demo-logging work: retrieval lines show pattern names (not just
 * scores), prompts group top-to-bottom with verdict-triggered flush, unit-test
 * noise is filtered, and expansion rescues are marked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GroupBuffer,
  formatDaemonLine,
  indexUsageLine,
  indexUsageRecord,
  parseDaemonMeta,
  parseKV,
  renderGroup,
  shouldSkip
} from '../scripts/watch.js';
import { topVariant } from '../lib/logger.js';

const OPTS = {
  verbose: false,
  follow: false,
  json: false,
  paranoid: false,
  group: false,
  showSynthetic: false
};

test('parseKV keeps quoted prompts with commas/spaces intact', () => {
  const kv = parseKV(
    'phash=abc12345, prompt="diagnose the failing suite, then report", scores=0.63/0.61, project=c32fc672ebc5'
  );
  assert.equal(kv.phash, 'abc12345');
  assert.equal(kv.prompt, 'diagnose the failing suite, then report');
  assert.equal(kv.scores, '0.63/0.61');
  assert.equal(kv.project, 'c32fc672ebc5');
});

test('parseKV skips bare flag tokens and handles empty input', () => {
  assert.deepEqual(parseKV(''), {});
  assert.deepEqual(parseKV('rescued, project=demo'), { project: 'demo' });
});

test('shouldSkip: explicit -p wins, synthetic filtered by default', () => {
  // No filter: real project passes, synthetic is hidden.
  assert.equal(shouldSkip('c32fc672ebc5', OPTS), false);
  assert.equal(shouldSkip('demo', OPTS), true);
  assert.equal(shouldSkip('test-project', OPTS), true);
  assert.equal(shouldSkip(undefined, OPTS), false);
  // Opt-in shows synthetic.
  assert.equal(shouldSkip('demo', { ...OPTS, showSynthetic: true }), false);
  // Explicit -p wins even for a synthetic project the user asked for.
  assert.equal(shouldSkip('demo', { ...OPTS, project: 'demo' }), false);
  assert.equal(shouldSkip('other', { ...OPTS, project: 'demo' }), true);
});

test('indexUsageRecord ingests retrieval facts incl. rescue + attribution', () => {
  const index = new Map();
  const facts = indexUsageRecord(index, {
    type: 'retrieval',
    prompt_hash: 'abc12345',
    project: 'c32fc672ebc5',
    prompt_preview: 'diagnose the failing suite',
    retrieved: ['patterns/a.md', 'gotchas/b.md'],
    similarity_scores: [0.63, 0.61],
    initial_best: 0.42,
    rescued: true,
    variant_attribution: { 'patterns/a.md': 1, 'gotchas/b.md': -1 }
  });
  assert.ok(facts);
  assert.deepEqual(facts.retrieved, ['patterns/a.md', 'gotchas/b.md']);
  assert.deepEqual(facts.scores, [0.63, 0.61]);
  assert.equal(facts.initialBest, 0.42);
  assert.equal(facts.rescued, true);
  assert.deepEqual(facts.variantAttribution, { 'patterns/a.md': 1, 'gotchas/b.md': -1 });
});

test('indexUsageRecord ingests verdicts and ignores non-verdicts', () => {
  const index = new Map();
  indexUsageLine(index, 'not json at all');
  // Malformed lines leave the index empty; unknown types accrue no verdict facts.
  assert.equal(index.size, 0);
  indexUsageLine(index, JSON.stringify({ type: 'capture', prompt_hash: 'abc12345', project: 'x' }));
  assert.equal(index.get('abc12345')?.used, undefined);
  assert.equal(index.get('abc12345')?.retrieved.length, 0);
  indexUsageLine(
    index,
    JSON.stringify({
      type: 'usage_signal',
      prompt_hash: 'abc12345',
      injected: ['patterns/a.md', 'gotchas/b.md'],
      used: ['patterns/a.md'],
      usage_rate: 0.5
    })
  );
  const facts = index.get('abc12345');
  assert.deepEqual(facts.used, ['patterns/a.md']);
  assert.deepEqual(facts.injected, ['patterns/a.md', 'gotchas/b.md']);
  assert.equal(facts.usageRate, 0.5);
});

test('formatDaemonLine joins pattern names from the usage index', () => {
  const index = new Map();
  indexUsageRecord(index, {
    type: 'retrieval',
    prompt_hash: 'abc12345',
    retrieved: ['patterns/a.md'],
    similarity_scores: [0.63]
  });
  const line =
    '[2026-06-16 13:34:09.258] INFO Retrieved 1 patterns ' +
    '(phash=abc12345, prompt="diagnose it", scores=0.63, latency=120ms, dropped=0, project=c32fc672ebc5)';
  const withJoin = formatDaemonLine(line, OPTS, index);
  assert.ok(withJoin?.includes('patterns/a.md'));
  const withoutJoin = formatDaemonLine(line, OPTS, new Map());
  assert.ok(withoutJoin && !withoutJoin.includes('patterns/a.md'));
});

test('formatDaemonLine marks expansion rescues and failed rescues', () => {
  const index = new Map();
  indexUsageRecord(index, {
    type: 'retrieval',
    prompt_hash: 'abc12345',
    retrieved: ['patterns/a.md'],
    similarity_scores: [0.63],
    initial_best: 0.42,
    rescued: true,
    variant_attribution: { 'patterns/a.md': 1 }
  });
  const rescued =
    '[2026-06-16 13:34:09.258] INFO Retrieved 1 patterns ' +
    '(phash=abc12345, prompt="diagnose it", scores=0.63, latency=120ms, dropped=0, rescued=true, initialBest=0.4200, topVariant=1, project=c32fc672ebc5)';
  const out = formatDaemonLine(rescued, OPTS, index);
  assert.ok(out?.includes('expansion rescued it'));
  assert.ok(out?.includes('variant [1]'));

  const failed =
    '[2026-06-16 13:34:09.258] INFO No retrieval ' +
    '(phash=abc12345, prompt="diagnose it", reason=below_floor, best=0.65, rescued=false, project=c32fc672ebc5)';
  assert.ok(
    formatDaemonLine(failed, OPTS, index)?.includes('expansion fired but still below floor')
  );
});

test('formatDaemonLine links eval verdicts back to judged patterns', () => {
  const index = new Map();
  indexUsageRecord(index, {
    type: 'calibration_eval',
    prompt_hash: 'abc12345',
    weighted_score: 1,
    evaluations: [{ score: 1 }],
    retrieved: ['patterns/a.md']
  });
  const line =
    '[2026-06-16 13:34:09.258] INFO Calibration eval ' +
    '(phash=abc12345, score=1.00, rated=1, of=1, project=c32fc672ebc5)';
  const out = formatDaemonLine(line, OPTS, index);
  assert.ok(out?.includes('judged 1.00 on: patterns/a.md'));
});

test('parseDaemonMeta extracts group keys and flags verdicts', () => {
  const meta = parseDaemonMeta(
    '[2026-06-16 13:34:09.258] INFO Usage signal (used=1/2, rate=50%, phash=abc12345, project=c32fc672ebc5)'
  );
  assert.equal(meta.phash, 'abc12345');
  assert.equal(meta.project, 'c32fc672ebc5');
  assert.equal(meta.isVerdict, true);

  const retrieval = parseDaemonMeta(
    '[2026-06-16 13:34:09.258] INFO Retrieved 1 patterns (phash=abc12345, prompt="hi", project=c32fc672ebc5)'
  );
  assert.equal(retrieval.prompt, 'hi');
  assert.equal(retrieval.isVerdict, false);
});

test('GroupBuffer holds a prompt until its verdict arrives', () => {
  const buf = new GroupBuffer();
  const meta = { phash: 'abc12345', project: 'c32fc672ebc5', prompt: 'hi' };
  assert.deepEqual(buf.push(meta.phash, meta.project, meta.prompt, 'line1'), []);
  assert.deepEqual(buf.push(meta.phash, meta.project, meta.prompt, 'line2'), []);
  assert.equal(buf.pending, 1);
  const flushed = buf.flushOne('abc12345');
  assert.equal(flushed.length, 1);
  assert.deepEqual(flushed[0].lines, ['line1', 'line2']);
  assert.equal(buf.pending, 0);
  // Unknown hash flushes nothing; unhashed lines pass straight through.
  assert.deepEqual(buf.flushOne('nope'), []);
  const passthrough = buf.push(undefined, 'x', undefined, 'raw');
  assert.equal(passthrough.length, 1);
  assert.ok(renderGroup(flushed[0]).includes('hi'));
});

test('topVariant picks the variant behind the most injected rows', () => {
  assert.equal(topVariant({ 'a.md': 1, 'b.md': 1, 'c.md': -1 }, ['a.md', 'b.md', 'c.md']), 1);
  assert.equal(topVariant({ 'a.md': -1 }, ['a.md']), -1);
  assert.equal(topVariant({}, ['a.md']), null);
});
