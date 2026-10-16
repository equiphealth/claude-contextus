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
import path from 'node:path';
import os from 'node:os';

// Looks for "git" ... "commit" anywhere on the line — deliberately NOT
// anchored to the start of a command segment (e.g. requiring it right after
// `;`/`&&`/`|`). Real-world git invocations are routinely wrapped — a shell
// alias/function, a PreToolUse hook rewrite, or simply typing `rtk git
// commit ...` (this very repo's own ~/.claude/settings.json permission
// allowlist has `Bash(rtk git *)`) — so "git" is often NOT the first token
// of its own segment. Anchoring to segment-start was tried and reverted: it
// stopped matching exactly those wrapped invocations, trading one cheap
// false positive for a silent false negative (the gate never firing at all),
// which is worse for a feature whose entire point is not missing a commit.
const GIT_COMMIT_RE = /\bgit\b[^\n]*(?<!=)\bcommit\b/i;

/**
 * Is the GIT_COMMIT_RE match at `matchIndex` a REAL git-commit invocation,
 * or a false positive the regex alone can't rule out? Excludes exactly the
 * two concrete cases found in review: "commit" as a flag VALUE (already
 * excluded by the regex's own `(?<!=)`, e.g. `git log --grep=commit`), and
 * "git commit" appearing as a quoted string literal rather than code (e.g.
 * `grep -rn "git commit" file.md`) — detected by an odd quote count before
 * the match, i.e. the match sits inside an unclosed quote.
 * @param {string} cmd
 * @param {number} matchIndex
 */
function isRealGitCommitMatch(cmd, matchIndex) {
  const before = cmd.slice(0, matchIndex);
  const doubleQuotes = (before.match(/"/g) || []).length;
  const singleQuotes = (before.match(/'/g) || []).length;
  return doubleQuotes % 2 === 0 && singleQuotes % 2 === 0;
}

/** Find the Bash tool_use (if any) whose command runs a real `git commit`. */
function findGitCommitCall(toolUses) {
  return toolUses.find((t) => {
    if (t.name !== 'Bash' || typeof t?.input?.command !== 'string') return false;
    const match = GIT_COMMIT_RE.exec(t.input.command);
    return match ? isRealGitCommitMatch(t.input.command, match.index) : false;
  });
}
const CAPTURE_SKIP_RE = /Context:\s*capture-skip:/i;
// Only "captured" counts as proof a file was actually written. "propose"
// (contextCapture.mode: "propose") only SUGGESTS a capture — nothing is
// written until the user accepts and /create-context runs — so it must not
// satisfy this gate on its own.
const CAPTURE_ACK_RE = /Context:\s*captured(\s*\[[^\]]+\])?:/i;
const DEFAULT_LOG_DIR = path.join(os.homedir(), '.contextus', 'logs');

/**
 * Is this transcript entry a genuine human-authored prompt (the real turn
 * boundary), as opposed to a tool_result — which Claude Code also records as
 * a `type: 'user'` entry (same shape the Messages API uses to return tool
 * results). Scanning backward for `type === 'user'` without this check stops
 * at the tool_result immediately following the LAST tool call of the turn
 * (e.g. the git commit's own result) instead of the actual prompt that
 * started it — silently losing every tool_use before that point, including
 * the commit itself. A real user message is either a plain string, an empty
 * content array, or an array containing at least one non-tool_result block.
 *
 * @param {{type?: string, message?: {content?: unknown}}} entry
 */
function isGenuineUserTurnStart(entry) {
  if (entry.type !== 'user') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content) || content.length === 0) return true;
  return !content.every((block) => block && block.type === 'tool_result');
}

/**
 * Read a transcript JSONL file and pull out the last turn: the assistant
 * tool_use blocks and visible text emitted after the most recent genuine
 * user message, plus that message's timestamp (the turn's start). Skips
 * over tool_result entries (also `type: 'user'`) and other non-assistant
 * bookkeeping entries (attachment, api-request, etc.) that aren't the real
 * boundary — see isGenuineUserTurnStart.
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
      if (!isGenuineUserTurnStart(entry)) continue; // a tool_result, not the real boundary
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
  return findGitCommitCall(toolUses) !== undefined;
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
 * Read captures.log (a single file shared by every project on the machine —
 * `daemon/server.ts`'s CAPTURES_LOG) and return the timestamp of the most
 * recent entry that's actually relevant to THIS project, or null if none.
 *
 * Without the `projectId` filter, a concurrent session capturing something
 * in an unrelated project would satisfy this project's gate check too — this
 * repo's own CLAUDE.md flags shared-cwd concurrent sessions as a known,
 * confirmed risk, and the global log has no per-session identity to
 * disambiguate otherwise. `user`-scope lines always count (legitimately
 * cross-project by design); `project`-scope lines only count when tagged
 * `project:<projectId>` (see `captureLogTag` in daemon/server.ts).
 *
 * @param {string} logPath
 * @param {string} [projectId] — when omitted, falls back to the old
 *   last-line-wins behavior (used by existing callers/tests that don't scope).
 */
export function lastCaptureTimestamp(logPath, projectId) {
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf-8');
  } catch {
    return null;
  }
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return null;

  if (!projectId) {
    const last = lines[lines.length - 1];
    const ts = last.split(' | ')[0];
    return ts && !Number.isNaN(Date.parse(ts)) ? ts : null;
  }

  const projectTag = `project:${projectId}`;
  for (let i = lines.length - 1; i >= 0; i--) {
    const parts = lines[i].split(' | ');
    const [ts, scope] = parts;
    if (scope === 'user' || scope === projectTag) {
      return ts && !Number.isNaN(Date.parse(ts)) ? ts : null;
    }
  }
  return null;
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

/**
 * Best-effort extraction of a human-readable summary of the commit that
 * triggered the gate, for the nudge log. Tries `-m "..."`/`-m '...'` first,
 * then this repo's heredoc commit convention (`-m "$(cat <<'EOF' ...`),
 * falling back to a generic label.
 * @param {Array<{name: string, input: unknown}>} toolUses
 */
export function extractCommitSummary(toolUses) {
  const commitCall = findGitCommitCall(toolUses);
  if (!commitCall) return null;
  const cmd = commitCall.input.command;
  // Heredoc convention (this repo's own commit style) first — it nests a
  // double-quoted `-m "$(cat <<'EOF' ...)"` that would otherwise falsely
  // match the plain -m "..." pattern below on its opening quote.
  let m = cmd.match(/<<['"]?EOF['"]?\s*\n([^\n]+)/);
  if (m) return m[1].trim();
  m = cmd.match(/-m\s+"([^"]+)"/) || cmd.match(/-m\s+'([^']+)'/);
  if (m) return m[1].split('\n')[0].trim();
  return 'recent commit';
}

function humanLine(level, message, kv) {
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const pairs = kv
    ? Object.entries(kv)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
    : '';
  return `[${ts}] ${level} ${message}${pairs ? ` (${pairs})` : ''}\n`;
}

const NUDGE_MESSAGES = {
  nudged: (summary) => `Nudged Claude to capture context for "${summary}" — waiting for response`,
  captured_after_nudge: (summary) => `Claude captured context for "${summary}" after being nudged`,
  missed: (summary) => `Nudged Claude to capture context for "${summary}" but it did not`,
};

/**
 * Log a capture-nudge outcome: structured JSONL (for the miss-rate metric)
 * plus a human-readable line in daemon.log (so it shows up in `contextus
 * watch`, per the existing running-log preference — the miss-rate metric
 * this repeats is otherwise invisible until someone asks "why didn't you
 * capture that?" after the fact).
 *
 * @param {object} args
 * @param {'nudged'|'captured_after_nudge'|'missed'} args.outcome
 * @param {string} args.project
 * @param {string} args.commitSummary
 * @param {string} [args.logDir]
 */
export function logCaptureNudge({ outcome, project, commitSummary, logDir = DEFAULT_LOG_DIR }) {
  const record = {
    type: 'capture_nudge',
    timestamp: new Date().toISOString(),
    project,
    outcome,
    commitSummary,
  };
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'capture-nudges.jsonl'), JSON.stringify(record) + '\n');
  } catch {
    // best-effort — never block the gate on a log failure
  }
  const level = outcome === 'missed' ? 'WARN' : 'INFO';
  const messageFn = NUDGE_MESSAGES[outcome];
  if (!messageFn) return;
  try {
    fs.appendFileSync(
      path.join(logDir, 'daemon.log'),
      humanLine(level, messageFn(commitSummary), { project })
    );
  } catch {
    // best-effort
  }
}
