/**
 * Session transcript parser — reads Claude Code .jsonl session logs into
 * structured conversation turns for downstream extraction.
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';

export interface ToolCall {
  name: string;
  input: string; // truncated to ~200 chars
}

export interface Turn {
  timestamp: string;
  userContent: string;
  assistantThinking: string;
  assistantText: string;
  toolCalls: ToolCall[];
  sessionId: string;
  sessionFile: string;
}

export interface ExtractionWindow {
  turns: Turn[];
  tokenEstimate: number;
}

const PROJECTS_DIR = path.join(homedir(), '.claude', 'projects');

/** Derive the Claude Code projects slug from an absolute path. */
export function projectSlug(projectPath: string): string {
  return projectPath.replace(/[/.]/g, '-');
}

/** Discover session files for a project, filtered by modification time. */
export function discoverSessions(projectPath: string, since?: Date): string[] {
  const slug = projectSlug(projectPath);
  const dir = path.join(PROJECTS_DIR, slug);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (!since) return files.map((f) => path.join(dir, f));

  return files
    .map((f) => path.join(dir, f))
    .filter((f) => {
      const stat = fs.statSync(f);
      return stat.mtime > since;
    })
    .sort((a, b) => fs.statSync(a).mtime.getTime() - fs.statSync(b).mtime.getTime());
}

/** List all project slugs that have session files. Reads cwd from first session to recover the real path. */
export function listProjects(): Array<{ slug: string; path: string; sessions: number }> {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs
    .readdirSync(PROJECTS_DIR)
    .filter((d) => {
      const full = path.join(PROJECTS_DIR, d);
      return fs.statSync(full).isDirectory();
    })
    .map((slug) => {
      const dir = path.join(PROJECTS_DIR, slug);
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
      // Recover actual path from cwd field in the first session's first user message
      let projPath = slug;
      if (files.length > 0) {
        try {
          const first = fs.readFileSync(path.join(dir, files[0]), 'utf8').split('\n').slice(0, 50);
          for (const line of first) {
            if (!line.trim()) continue;
            const obj = JSON.parse(line);
            if (obj.cwd && typeof obj.cwd === 'string') {
              projPath = obj.cwd;
              break;
            }
          }
        } catch {
          /* ignore unreadable sessions */
        }
      }
      return { slug, path: projPath, sessions: files.length };
    })
    .filter((p) => p.sessions > 0);
}

interface RawMessage {
  type: string;
  message?: {
    role?: string;
    content?:
      | string
      | Array<{ type: string; text?: string; thinking?: string; name?: string; input?: unknown }>;
  };
  timestamp?: string;
  sessionId?: string;
}

/** Parse a single session file into turns (streaming, memory-efficient). */
export async function parseSession(filePath: string): Promise<Turn[]> {
  const turns: Turn[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let pendingUser: { content: string; timestamp: string; sessionId: string } | null = null;
  const sessionFile = path.basename(filePath);

  for await (const line of rl) {
    if (!line.trim()) continue;
    let obj: RawMessage;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }

    if (obj.type === 'user') {
      // Start a new turn
      const content = extractUserContent(obj.message?.content);
      if (content) {
        pendingUser = {
          content,
          timestamp: obj.timestamp ?? '',
          sessionId: obj.sessionId ?? ''
        };
      }
    } else if (obj.type === 'assistant' && pendingUser) {
      // Complete the turn
      const blocks = obj.message?.content;
      const { thinking, text, tools } = extractAssistantContent(blocks);

      turns.push({
        timestamp: pendingUser.timestamp,
        userContent: pendingUser.content,
        assistantThinking: thinking,
        assistantText: text,
        toolCalls: tools,
        sessionId: pendingUser.sessionId,
        sessionFile
      });
      pendingUser = null;
    }
  }

  return turns;
}

function extractUserContent(
  content: string | Array<{ type: string; text?: string }> | undefined
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

function extractAssistantContent(blocks: NonNullable<RawMessage['message']>['content']): {
  thinking: string;
  text: string;
  tools: ToolCall[];
} {
  if (!blocks || typeof blocks === 'string') return { thinking: '', text: blocks ?? '', tools: [] };

  let thinking = '';
  let text = '';
  const tools: ToolCall[] = [];

  for (const block of blocks) {
    if (block.type === 'thinking' && block.thinking) {
      thinking += block.thinking + '\n';
    } else if (block.type === 'text' && block.text) {
      text += block.text + '\n';
    } else if (block.type === 'tool_use' && block.name) {
      tools.push({
        name: block.name,
        input: JSON.stringify(block.input ?? {}).slice(0, 200)
      });
    }
  }

  return { thinking: thinking.trim(), text: text.trim(), tools };
}

/** Rough token estimate (~4 chars per token). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Filter turns that are likely to contain extractable knowledge. */
export function filterInterestingTurns(turns: Turn[]): Turn[] {
  return turns.filter((t) => {
    const totalText = t.userContent.length + t.assistantText.length + t.assistantThinking.length;
    // Skip trivial exchanges
    if (totalText < 200) return false;
    // Skip pure tool-only responses (no reasoning)
    if (!t.assistantText && !t.assistantThinking) return false;
    return true;
  });
}

/**
 * Group turns into extraction windows (~4000 tokens each).
 * Overlap by 1 turn to catch cross-turn patterns.
 */
export function windowTurns(turns: Turn[], maxTokens = 4000): ExtractionWindow[] {
  const windows: ExtractionWindow[] = [];
  let current: Turn[] = [];
  let currentTokens = 0;

  for (const turn of turns) {
    const turnTokens = estimateTokens(
      turn.userContent + turn.assistantText + turn.assistantThinking
    );

    if (currentTokens + turnTokens > maxTokens && current.length > 0) {
      windows.push({ turns: [...current], tokenEstimate: currentTokens });
      // Overlap: keep last turn
      current = [current[current.length - 1]];
      currentTokens = estimateTokens(
        current[0].userContent + current[0].assistantText + current[0].assistantThinking
      );
    }

    current.push(turn);
    currentTokens += turnTokens;
  }

  if (current.length > 0) {
    windows.push({ turns: current, tokenEstimate: currentTokens });
  }

  return windows;
}
