/**
 * captures-log — append-only audit trail for context captures.
 *
 * Every context file written (staging mode or /create-context) logs here.
 * Format: ISO timestamp | scope | relative path | description
 * File: ~/.contextus/captures.log
 */

import fs from 'node:fs';
import path from 'node:path';

const LOG_PATH = path.resolve(
  process.env.HOME || '~',
  '.contextus',
  'captures.log'
);

/**
 * Append a capture entry.
 * @param {object} opts
 * @param {string} opts.scope - 'user' or 'project:<name>'
 * @param {string} opts.file - relative path of the captured file
 * @param {string} opts.description - one-line summary
 */
export function logCapture({ scope, file, description }) {
  const line = `${new Date().toISOString()} | ${scope} | ${file} | ${JSON.stringify(description)}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line);
  } catch {
    // Best-effort — never block a capture on a log failure
  }
}
