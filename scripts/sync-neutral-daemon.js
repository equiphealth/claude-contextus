#!/usr/bin/env node
/**
 * sync-neutral-daemon — setup engine for the neutral daemon home.
 *
 * Plain ESM JavaScript (zero deps): runs on bare `node`, before any install
 * exists. Syncs ~/.contextus/daemon/ (code + deps + dist + version stamp).
 * Idempotent; exit non-zero on any failure so setup fails loudly.
 *
 * Usage:
 *   node scripts/sync-neutral-daemon.js
 */
import { syncNeutralDaemon } from './lib/daemon-control.js';

try {
  const r = syncNeutralDaemon({ log: (m) => console.log(`  neutral daemon  ${m}`) });
  console.log(`  neutral daemon  ${r.synced ? 'synced' : 'already in sync'} (${r.found || r.expected})`);
} catch (err) {
  console.error(`\n✗ neutral daemon sync failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
