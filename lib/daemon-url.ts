/**
 * Daemon base URL resolution with dynamic port discovery.
 *
 * Priority:
 *   1. CONTEXTUS_DAEMON_URL env var (set by daemon-config.sh or user override)
 *   2. ~/.contextus/runtime/daemon.port file (written by daemon at startup)
 *   3. CONTEXTUS_DAEMON_PORT env var or 37800 default
 *
 * Matches daemon-config.sh logic for consistency across shell and JS contexts.
 * Result is cached for the lifetime of the process.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PREFERRED_PORT = 37800;
const PORT_PATH = path.join(os.homedir(), '.contextus', 'runtime', 'daemon.port');

let cachedURL: string | null = null;

export function getDaemonURL(): string {
  if (cachedURL) {
    return cachedURL;
  }

  // 1. Check env var (set by daemon-config.sh or user override)
  if (process.env.CONTEXTUS_DAEMON_URL) {
    cachedURL = process.env.CONTEXTUS_DAEMON_URL;
    return cachedURL;
  }

  // 2. Read actual port from runtime file (written by daemon at startup)
  try {
    if (fs.existsSync(PORT_PATH)) {
      const content = fs.readFileSync(PORT_PATH, 'utf-8').trim();
      const port = parseInt(content, 10);
      if (port > 0 && port < 65536) {
        cachedURL = `http://127.0.0.1:${port}`;
        return cachedURL;
      }
    }
  } catch {
    // File doesn't exist or is unreadable — fall through
  }

  // 3. Fall back to preferred port (from env var or constant)
  const port = parseInt(process.env.CONTEXTUS_DAEMON_PORT || String(PREFERRED_PORT), 10);
  cachedURL = `http://127.0.0.1:${port}`;
  return cachedURL;
}

/**
 * Clear the cached URL (useful for tests or when daemon restarts with a new port).
 */
export function clearDaemonURLCache(): void {
  cachedURL = null;
}
