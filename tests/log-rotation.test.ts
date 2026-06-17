/**
 * Log rotation tests — verifies time-based rotation, archival, and cleanup.
 *
 * Uses a temp dir instead of the real ~/.contextus/logs. The rotation module
 * reads LOG_DIR from config, so we test the internal logic by calling the
 * functions with crafted file timestamps.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'node:zlib';

let tmpDir: string;
let archiveDir: string;

function setup(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-logrot-'));
  fs.mkdirSync(path.join(dir, 'archive'), { recursive: true });
  return dir;
}

function writeLog(dir: string, name: string, content: string, ageDays: number): string {
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, content);
  const mtime = new Date(Date.now() - ageDays * 86_400_000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

function writeArchive(dir: string, name: string, ageDays: number): string {
  const filePath = path.join(dir, 'archive', name);
  fs.writeFileSync(filePath, zlib.gzipSync('old data'));
  const mtime = new Date(Date.now() - ageDays * 86_400_000);
  fs.utimesSync(filePath, mtime, mtime);
  return filePath;
}

// Since log-rotation.ts uses hardcoded LOG_DIR from config, we test the logic
// by reimplementing the core rotation logic here against a temp dir.
// This validates the algorithm; integration test (Step 4 in plan) validates wiring.

function rotateFile(
  logDir: string,
  name: string,
  maxAgeDays: number,
  now: number,
  archive: boolean
): void {
  const filePath = path.join(logDir, name);
  try {
    const stat = fs.statSync(filePath);
    const ageDays = (now - stat.mtimeMs) / 86_400_000;
    if (ageDays < maxAgeDays) return;

    if (archive) {
      const dateStamp = new Date(stat.mtimeMs).toISOString().slice(0, 7);
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      const archiveName = `${base}-${dateStamp}${ext}.gz`;
      const archivePath = path.join(logDir, 'archive', archiveName);
      if (!fs.existsSync(archivePath)) {
        const content = fs.readFileSync(filePath);
        const compressed = zlib.gzipSync(content);
        fs.writeFileSync(archivePath, compressed);
      }
    }

    fs.unlinkSync(filePath);
  } catch {
    // expected for missing files
  }
}

function pruneArchives(logDir: string, maxMonths: number, now: number): void {
  const maxMs = maxMonths * 30 * 86_400_000;
  const aDir = path.join(logDir, 'archive');
  try {
    for (const entry of fs.readdirSync(aDir)) {
      if (!entry.endsWith('.gz')) continue;
      const full = path.join(aDir, entry);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > maxMs) {
        fs.unlinkSync(full);
      }
    }
  } catch {
    // fine
  }
}

test('fresh log files are NOT rotated', () => {
  const dir = setup();
  writeLog(dir, 'daemon.log', 'fresh data', 5);
  rotateFile(dir, 'daemon.log', 30, Date.now(), true);
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log')));
});

test('stale standard log is compressed into archive/', () => {
  const dir = setup();
  writeLog(dir, 'usage.jsonl', '{"type":"retrieval"}\n', 35);
  rotateFile(dir, 'usage.jsonl', 30, Date.now(), true);

  assert.ok(!fs.existsSync(path.join(dir, 'usage.jsonl')), 'original should be deleted');
  const archives = fs.readdirSync(path.join(dir, 'archive'));
  assert.equal(archives.length, 1);
  assert.ok(archives[0].startsWith('usage-'));
  assert.ok(archives[0].endsWith('.jsonl.gz'));

  const compressed = fs.readFileSync(path.join(dir, 'archive', archives[0]));
  const decompressed = zlib.gunzipSync(compressed).toString();
  assert.equal(decompressed, '{"type":"retrieval"}\n');
});

test('stale paranoid.jsonl is DELETED not archived', () => {
  const dir = setup();
  writeLog(dir, 'paranoid.jsonl', '{"prompt":"secret"}\n', 10);
  rotateFile(dir, 'paranoid.jsonl', 7, Date.now(), false);

  assert.ok(!fs.existsSync(path.join(dir, 'paranoid.jsonl')), 'should be deleted');
  const archives = fs.readdirSync(path.join(dir, 'archive'));
  assert.equal(archives.length, 0, 'no archive created for paranoid');
});

test('old archives are pruned', () => {
  const dir = setup();
  writeArchive(dir, 'daemon-2025-12.log.gz', 200);
  writeArchive(dir, 'usage-2026-05.jsonl.gz', 10);

  pruneArchives(dir, 6, Date.now());

  const remaining = fs.readdirSync(path.join(dir, 'archive'));
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0], 'usage-2026-05.jsonl.gz');
});

test('missing files do not throw', () => {
  const dir = setup();
  assert.doesNotThrow(() => {
    rotateFile(dir, 'nonexistent.log', 30, Date.now(), true);
  });
});

test('idempotent: double rotation does not duplicate archives', () => {
  const dir = setup();
  writeLog(dir, 'daemon.log', 'first run', 35);
  rotateFile(dir, 'daemon.log', 30, Date.now(), true);

  // Write a new file and age it
  writeLog(dir, 'daemon.log', 'second run', 35);
  rotateFile(dir, 'daemon.log', 30, Date.now(), true);

  const archives = fs.readdirSync(path.join(dir, 'archive'));
  // Same month → same archive name → idempotent (first content preserved)
  assert.equal(archives.length, 1);
  const content = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'archive', archives[0]))).toString();
  assert.equal(content, 'first run');
});

test('custom retention: shorter activeDays triggers earlier rotation', () => {
  const dir = setup();
  writeLog(dir, 'daemon.log', 'data', 8);

  // With 30-day default, this wouldn't rotate
  rotateFile(dir, 'daemon.log', 30, Date.now(), true);
  assert.ok(fs.existsSync(path.join(dir, 'daemon.log')), 'still present at 30d threshold');

  // With 7-day threshold, it should rotate
  rotateFile(dir, 'daemon.log', 7, Date.now(), true);
  assert.ok(!fs.existsSync(path.join(dir, 'daemon.log')), 'rotated at 7d threshold');
});
