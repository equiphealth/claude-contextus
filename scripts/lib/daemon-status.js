/**
 * daemon-status — pure decision logic for the SessionStart hook's user message.
 *
 * Extracted from session-start-hook.js so it's importable WITHOUT running the
 * hook's main() (the same "don't import an entry point" hazard the
 * hook-files-esm-and-smoke-test memory warns about) and so the branching is
 * unit-testable without spawning a daemon.
 *
 * The job: given the daemon's /health (or its absence) and whether we just
 * spawned it, decide the honest user-facing line. The critical case this fixes is
 * SILENT FAILURE — a provider-down daemon used to surface as nothing, or as a
 * misleading "still warming" (implying transient when it's a hard outage).
 */

/**
 * Honest, actionable message when warmup HARD-failed (provider unreachable).
 * Names the provider + the fix. Exported for reuse/testing.
 */
export function providerDownMessage(health) {
  const provider = (health && health.provider) || 'embedding provider';
  const model = health && health.embeddingModel ? ` (${health.embeddingModel})` : '';
  const hint =
    provider === 'ollama'
      ? ' Is Ollama running? Try `ollama serve` (and `ollama pull nomic-embed-text`).'
      : ' Check the embedding model is reachable (see plugin.json config.embedding).';
  return `contextus: ${provider}${model} is unreachable — NO context injection this session.${hint}`;
}

/**
 * Decide the session-start status from daemon state.
 *
 * @param {object} opts
 * @param {boolean} opts.wasRunning  a daemon already answered /health (vs we spawned one)
 * @param {boolean} opts.warmModel   the model is loaded (only meaningful when we waited)
 * @param {object|null} opts.health  the latest /health body, or null if unreachable
 * @param {string} opts.verbosity    silent | normal | verbose
 * @returns {{ warmOk: boolean, message: string|null }}
 *   warmOk → safe to proceed with auto-reconcile; message → user line (verbosity-filtered)
 */
export function resolveDaemonStatus({ wasRunning, warmModel, health, verbosity }) {
  // Hard failure takes precedence wherever we can see it — always worth surfacing.
  if (health && health.warmupError) {
    return { warmOk: false, message: providerDownMessage(health) };
  }

  if (wasRunning) {
    if (health && health.modelLoaded) {
      // Happy path: an existing warm daemon. Heartbeat only at verbose.
      if (verbosity === 'verbose') {
        const up = health.uptime != null ? ` (uptime ${formatUptime(health.uptime)})` : '';
        return { warmOk: true, message: `contextus: using the running daemon${up}.` };
      }
      return { warmOk: true, message: null };
    }
    // Running but not warm and no recorded error → genuinely still loading.
    return {
      warmOk: false,
      message:
        'contextus: daemon is up but the embedding model is still loading; the first prompt or two may not get context yet.',
    };
  }

  // We just spawned one.
  if (warmModel) {
    return {
      warmOk: true,
      message: 'contextus: started a new daemon (model warm, ready to inject).',
    };
  }
  // Didn't warm in time and no hard error visible → still warming (transient).
  return {
    warmOk: false,
    message:
      'contextus: started a new daemon — model still warming; the first prompt or two may not get context yet.',
  };
}

/** Format a daemon uptime (seconds) as a compact human string: 4h, 12m, 8s. */
export function formatUptime(seconds) {
  const s = Math.round(seconds || 0);
  if (s >= 3600) return `${Math.floor(s / 3600)}h`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}
