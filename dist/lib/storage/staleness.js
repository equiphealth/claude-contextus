/**
 * Staleness — content-hash change detection for incremental re-embed.
 *
 * The watcher (PostToolUse → /notify) can fire on saves that don't actually
 * change a file's body (formatter passes, touch, re-save). Re-embedding then is
 * wasted model work. We persist a content hash per row (sidecar in the project DB
 * dir, see lance-client) and skip the embed when the new content hashes the same.
 *
 * Pure logic, no I/O — the sidecar read/write lives in lance-client; this module
 * just hashes and compares so it's trivially unit-testable.
 */
import crypto from 'crypto';
/** Stable content fingerprint: full SHA-256 hex of the (trimmed) body. */
export function contentHash(text) {
    return crypto.createHash('sha256').update(text.trim()).digest('hex');
}
/**
 * Has the content changed vs. the stored hash? A missing/empty stored hash is
 * STALE (never embedded → must embed). Equal hashes are fresh (skip).
 */
export function isStale(storedHash, currentContent) {
    if (!storedHash)
        return true;
    return storedHash !== contentHash(currentContent);
}
//# sourceMappingURL=staleness.js.map