/**
 * Log rotation — runs once on daemon startup, before the server listens.
 *
 * Standard logs: rotate after activeDays, compress to archive/, prune after archiveMonths.
 * Paranoid log: delete after paranoidDays, never archive (privacy-sensitive).
 */
import fs from 'fs';
import path from 'path';
import zlib from 'node:zlib';
import { expandHome, loadConfig } from './config.js';
const LOG_DIR = expandHome('~/.contextus/logs');
const ARCHIVE_DIR = path.join(LOG_DIR, 'archive');
const STANDARD_LOGS = ['daemon.log', 'usage.jsonl', 'errors.jsonl'];
const PARANOID_LOG = 'paranoid.jsonl';
export function rotateLogsOnStartup() {
    try {
        fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    }
    catch {
        return;
    }
    const cfg = loadConfig();
    const { activeDays, archiveMonths, paranoidDays } = cfg.logging.retention;
    const now = Date.now();
    for (const name of STANDARD_LOGS) {
        rotateFile(name, activeDays, now, true);
    }
    rotateFile(PARANOID_LOG, paranoidDays, now, false);
    pruneArchives(archiveMonths, now);
}
function rotateFile(name, maxAgeDays, now, archive) {
    const filePath = path.join(LOG_DIR, name);
    try {
        const stat = fs.statSync(filePath);
        const ageDays = (now - stat.mtimeMs) / 86_400_000;
        if (ageDays < maxAgeDays)
            return;
        if (archive) {
            const dateStamp = new Date(stat.mtimeMs).toISOString().slice(0, 7);
            const ext = path.extname(name);
            const base = path.basename(name, ext);
            const archiveName = `${base}-${dateStamp}${ext}.gz`;
            const archivePath = path.join(ARCHIVE_DIR, archiveName);
            if (!fs.existsSync(archivePath)) {
                const content = fs.readFileSync(filePath);
                const compressed = zlib.gzipSync(content);
                fs.writeFileSync(archivePath, compressed);
            }
        }
        fs.unlinkSync(filePath);
    }
    catch {
        // file missing or unreadable — nothing to rotate
    }
}
function pruneArchives(maxMonths, now) {
    const maxMs = maxMonths * 30 * 86_400_000;
    try {
        for (const entry of fs.readdirSync(ARCHIVE_DIR)) {
            if (!entry.endsWith('.gz'))
                continue;
            const full = path.join(ARCHIVE_DIR, entry);
            const stat = fs.statSync(full);
            if (now - stat.mtimeMs > maxMs) {
                fs.unlinkSync(full);
            }
        }
    }
    catch {
        // archive dir missing or unreadable — fine
    }
}
//# sourceMappingURL=log-rotation.js.map