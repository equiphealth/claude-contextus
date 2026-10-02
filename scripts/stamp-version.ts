#!/usr/bin/env node
/**
 * stamp-version — write ~/.contextus/version.json to match the installed
 * package.json version (or an explicit --version override).
 *
 * Exists so /contextus-upgrade's "Step 4: Stamp Version" doesn't need to
 * generate a throwaway `node -e` one-liner (or a temp .ts file) every run —
 * environments that block inline `node -e` execution (e.g. lean-ctx shell
 * allowlists) turned that one-liner into a Write-temp-file + run + delete
 * dance, costing 2+ permission prompts for what should be a single call.
 *
 * Usage:
 *   npx tsx scripts/stamp-version.ts              # stamp to installed package.json version
 *   npx tsx scripts/stamp-version.ts --version X   # stamp to an explicit version (rare)
 */

import { writeVersionState, getInstalledVersion } from '../lib/version.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--version');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : getInstalledVersion();
}

const version = parseArgs();
writeVersionState(version);
console.log(`Stamped version: ${version}`);
