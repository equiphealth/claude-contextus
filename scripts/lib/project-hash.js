/**
 * Shared project-identifier hash for plain-JS hook scripts (no build step, so
 * they can't import lib/config.ts's TypeScript projectHash() directly).
 *
 * Must match lib/config.ts's projectHash() exactly:
 *   crypto.createHash('sha256').update(path.resolve(absolutePath)).digest('hex').slice(0, 12)
 *
 * Before this module existed, scripts/stop-evaluation.js and
 * scripts/capture-gate-hook.js each carried their own independent copy of
 * this formula (with a comment warning the two must stay in sync) — a third
 * copy drifting from the canonical one would have silently desynced project
 * IDs across the daemon, usage logs, and these hooks with no error anywhere.
 * This is the one place a future change to the canonical formula needs to
 * also be made for every plain-JS hook that computes it.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export function projectHash(absolutePath) {
  const normalized = path.resolve(absolutePath);
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}
