/**
 * daemon-status tests — the SessionStart hook's health→message decision, with
 * emphasis on the SILENT-FAILURE fix: a provider-down daemon must surface an
 * honest, actionable message, never nothing and never a misleading "still warming".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain JS hook lib, no types
import { resolveDaemonStatus, providerDownMessage } from '../scripts/lib/daemon-status.js';

const downHealth = {
  modelLoaded: false,
  warmupError: 'fetch failed',
  provider: 'ollama',
  embeddingModel: 'nomic-embed-text'
};
const warmHealth = {
  modelLoaded: true,
  warmupError: null,
  provider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  uptime: 120
};

test('provider down (existing daemon) → honest, actionable message; not warmOk', () => {
  const s = resolveDaemonStatus({
    wasRunning: true,
    warmModel: false,
    health: downHealth,
    verbosity: 'normal'
  });
  assert.equal(s.warmOk, false, 'must not proceed as if injecting');
  assert.match(s.message, /unreachable/i);
  assert.match(s.message, /NO context injection/i);
  assert.match(s.message, /ollama serve/i, 'actionable provider-specific hint');
});

test('provider down (just spawned, never warmed) → same honest message', () => {
  const s = resolveDaemonStatus({
    wasRunning: false,
    warmModel: false,
    health: downHealth,
    verbosity: 'normal'
  });
  assert.equal(s.warmOk, false);
  assert.match(s.message, /unreachable/i);
});

test('provider down message must NOT be the misleading "still warming"', () => {
  const s = resolveDaemonStatus({
    wasRunning: false,
    warmModel: false,
    health: downHealth,
    verbosity: 'normal'
  });
  assert.doesNotMatch(s.message, /still warming/i, 'hard failure must not read as transient');
});

test('warm existing daemon → warmOk, quiet at normal, heartbeat at verbose', () => {
  const normal = resolveDaemonStatus({
    wasRunning: true,
    warmModel: false,
    health: warmHealth,
    verbosity: 'normal'
  });
  assert.equal(normal.warmOk, true);
  assert.equal(normal.message, null, 'no heartbeat at normal verbosity');

  const verbose = resolveDaemonStatus({
    wasRunning: true,
    warmModel: false,
    health: warmHealth,
    verbosity: 'verbose'
  });
  assert.equal(verbose.warmOk, true);
  assert.match(verbose.message, /using the running daemon/i);
  assert.match(verbose.message, /uptime 2m/, 'formats uptime');
});

test('freshly spawned + warmed → warmOk + ready message', () => {
  const s = resolveDaemonStatus({
    wasRunning: false,
    warmModel: true,
    health: warmHealth,
    verbosity: 'normal'
  });
  assert.equal(s.warmOk, true);
  assert.match(s.message, /model warm, ready to inject/i);
});

test('running but still loading (no error) → not warmOk, transient message', () => {
  const loading = { modelLoaded: false, warmupError: null, provider: 'ollama' };
  const s = resolveDaemonStatus({
    wasRunning: true,
    warmModel: false,
    health: loading,
    verbosity: 'normal'
  });
  assert.equal(s.warmOk, false);
  assert.match(s.message, /still loading/i);
  assert.doesNotMatch(s.message, /unreachable/i, 'no error yet → not a hard failure');
});

test('spawned, did not warm in time, no error → transient "still warming"', () => {
  const loading = { modelLoaded: false, warmupError: null, provider: 'ollama' };
  const s = resolveDaemonStatus({
    wasRunning: false,
    warmModel: false,
    health: loading,
    verbosity: 'normal'
  });
  assert.equal(s.warmOk, false);
  assert.match(s.message, /still warming/i);
});

test('warmupError takes precedence even if modelLoaded somehow true', () => {
  // defensive: a hard error should win regardless of a stale modelLoaded flag
  const s = resolveDaemonStatus({
    wasRunning: true,
    warmModel: false,
    health: { modelLoaded: true, warmupError: 'fetch failed', provider: 'ollama' },
    verbosity: 'normal'
  });
  assert.match(s.message, /unreachable/i);
});

test('providerDownMessage: non-ollama provider gets the generic hint', () => {
  const msg = providerDownMessage({ provider: 'transformers', embeddingModel: 'nomic' });
  assert.match(msg, /transformers/);
  assert.match(msg, /plugin\.json/);
  assert.doesNotMatch(msg, /ollama serve/);
});
