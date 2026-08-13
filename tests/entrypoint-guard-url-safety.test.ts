/**
 * Regression for the `import.meta.url === file://${process.argv[1]}` entrypoint
 * guard being unsafe for paths containing spaces/special characters (found in
 * independent review of PR #40, GH issue #39).
 *
 * `import.meta.url` is percent-encoded by Node (spaces become %20);
 * `process.argv[1]` is a raw filesystem path, never encoded. The naive
 * string-concat comparison therefore silently NEVER matches for any install
 * path requiring encoding — e.g. a macOS home dir like `/Users/First Last/`
 * (plausible; not exotic) — which means `main()` never runs, and since the
 * SessionStart trigger spawns this file with `stdio: 'ignore'`
 * (fireTranscriptMining, scripts/lib/daemon-control.js), the failure is
 * completely silent forever.
 *
 * `scripts/mine-transcripts.ts` fixed this with `pathToFileURL(...).href`.
 * This test proves the FIX is correct and the OLD pattern was genuinely
 * broken — it doesn't (and can't easily) exercise the top-level `if` guard
 * itself, since that's a module-load-time statement, not an exported
 * function. Spawns a real child Node process from a path containing a space
 * to get a genuine, unconfounded argv[1]/import.meta.url pair (avoids macOS's
 * `/tmp` → `/private/tmp` symlink, which independently makes even the
 * CORRECT comparison mismatch if the probe file lives under /tmp — a
 * red herring unrelated to the actual space/encoding bug this test targets).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PROBE = `
import { pathToFileURL } from 'node:url';
console.log(JSON.stringify({
  naive: import.meta.url === \`file://\${process.argv[1]}\`,
  safe: import.meta.url === pathToFileURL(process.argv[1]).href
}));
`;

test('naive file:// string comparison fails for a path containing a space', () => {
  // Real home-dir-style path, not /tmp — avoids the symlink red herring.
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'contextus-itest-space '));
  try {
    const probeFile = path.join(dir, 'probe.mjs');
    fs.writeFileSync(probeFile, PROBE);
    const out = execFileSync(process.execPath, [probeFile], { encoding: 'utf-8' });
    const result = JSON.parse(out);
    assert.equal(result.naive, false, 'naive comparison should mismatch on a spaced path');
    assert.equal(result.safe, true, 'pathToFileURL comparison should correctly match');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both comparisons agree for a path with no special characters', () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), 'contextus-itest-plain-'));
  try {
    const probeFile = path.join(dir, 'probe.mjs');
    fs.writeFileSync(probeFile, PROBE);
    const out = execFileSync(process.execPath, [probeFile], { encoding: 'utf-8' });
    const result = JSON.parse(out);
    assert.equal(result.naive, true);
    assert.equal(result.safe, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
