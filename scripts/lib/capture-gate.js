/**
 * capture-gate — pure helpers for the Stop-hook capture enforcement prototype.
 *
 * Background (see .claude/context/decisions/decision-capture-enforcement-needs-a-stop-hook-not-wording.md):
 * the UserPromptSubmit capture nudge is a soft reminder competing for attention
 * against whatever the live task is, and nothing blocks a turn from ending
 * without a capture call — so on long tasks it gets read every turn and
 * deferred to a "later" that never arrives. This module implements the
 * heuristic side of a Stop-hook gate: did this turn commit code without a
 * matching capture, and if so, is there an explicit skip acknowledgment?
 *
 * Deliberately narrow heuristic (a `git commit` ran this turn) rather than an
 * LLM judgment call — cheap, deterministic, and correct enough to prototype
 * with. False positives cost one extra Stop-hook round trip, not a bad
 * capture.
 */

import fs from 'node:fs';

const GIT_COMMIT_RE = /\bgit\b[^\n]*\bcommit\b/i;
const CAPTURE_SKIP_RE = /Context:\s*capture-skip:/i;
const CAPTURE_ACK_RE = /Context:\s*(captured|propose):/i;

/**
 * Read a transcript JSONL file and pull out the last turn: the assistant
 * tool_use blocks and visible text emitted after the most recent `user`
 * message, plus that user message's timestamp (the turn's start).
 *
 * @param {string} transcriptPath
 * @returns {{ toolUses: Array<{name: string, input: unknown}>, responseText: string, turnStartTs: string|null }}
 */
export function extractLastTurn(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);
  } catch {
    return { toolUses: [], responseText: '', turnStartTs: null };
  }

  const toolUses = [];
  const textParts = [];
  let turnStartTs = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (entry.type === 'user') {
      turnStartTs = entry.timestamp || turnStartTs;
      break;
    }
    if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) {
      continue;
    }
    for (const block of entry.message.content) {
      if (block.type === 'tool_use') {
        toolUses.unshift({ name: block.name, input: block.input });
      } else if (block.type === 'text' && block.text) {
        textParts.unshift(block.text);
      }
    }
  }

  return { toolUses, responseText: textParts.join('\n'), turnStartTs };
}

/** Did this turn run a `git commit` (any Bash tool_use containing it)? */
export function hasGitCommit(toolUses) {
  return toolUses.some(
    (t) => t.name === 'Bash' && typeof t?.input?.command === 'string' && GIT_COMMIT_RE.test(t.input.command)
  );
}

/** Did the response explicitly acknowledge skipping capture on purpose? */
export function hasExplicitSkip(responseText) {
  return CAPTURE_SKIP_RE.test(responseText || '');
}

/** Did the response claim a capture/propose happened (footer contract)? */
export function hasCaptureFooter(responseText) {
  return CAPTURE_ACK_RE.test(responseText || '');
}

/**
 * Read the last line of the captures.log audit trail and return its ISO
 * timestamp, or null if the log is missing/empty/unparseable.
 * @param {string} logPath
 */
export function lastCaptureTimestamp(logPath) {
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  const ts = last.split(' | ')[0];
  return ts && !Number.isNaN(Date.parse(ts)) ? ts : null;
}

/**
 * Decide whether the Stop hook should block turn completion.
 *
 * Blocks only when: a git commit ran this turn, AND there is no explicit
 * capture-skip acknowledgment, AND neither the response footer nor the
 * captures.log audit trail shows a capture logged since the turn began.
 *
 * @param {object} args
 * @param {Array<{name: string, input: unknown}>} args.toolUses
 * @param {string} args.responseText
 * @param {string|null} args.turnStartTs
 * @param {string|null} args.lastCaptureTs
 */
export function shouldBlockForCapture({ toolUses, responseText, turnStartTs, lastCaptureTs }) {
  if (!hasGitCommit(toolUses)) return false;
  if (hasExplicitSkip(responseText)) return false;
  if (hasCaptureFooter(responseText)) return false;
  if (turnStartTs && lastCaptureTs && Date.parse(lastCaptureTs) >= Date.parse(turnStartTs)) {
    return false; // a capture was logged after this turn started
  }
  return true;
}
