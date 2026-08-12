/**
 * Pattern extraction from conversation windows — sends grouped turns to an
 * LLM (Haiku via Bedrock, Ollama fallback) and parses structured output.
 */

import { callEvalModel, type EvalModelConfig } from '../calibration/eval-model.js';
import type { ExtractionWindow } from './parser.js';

export interface ExtractedPattern {
  category: string;
  slug: string;
  description: string;
  body: string;
  confidence: number;
  sourceTurns: number[];
  /** 'project' = specific to the codebase this transcript came from (architecture,
   * files, domain rules). 'user' = a tool/skill/workflow insight that applies
   * regardless of which project the session happened in. Defaults to 'project'
   * when the LLM omits or mangles the field — a mis-scoped-as-project pattern is
   * easy to notice and move later, while a real project insight silently landing
   * in the user's cross-project corpus is more likely to just get lost. See
   * gotchas/gotcha-transcript-mining-hardcodes-project-scope.md for the bug this
   * fixes: mining previously wrote every pattern as scope:project regardless of
   * content, mirroring the routing the live /capture flow already does. */
  scope: 'project' | 'user';
}

export interface ExtractionResult {
  patterns: ExtractedPattern[];
  windowIndex: number;
  tokensUsed: number;
}

const VALID_CATEGORIES = [
  'decision',
  'gotcha',
  'reference',
  'implementation',
  'tradeoff',
  'arch',
  'api',
  'phase',
  'project',
  'schema',
  'security',
  'perf'
];

const EXTRACTION_PROMPT = `You are extracting reusable development knowledge from a session transcript.

For each conversation window, identify patterns useful in FUTURE sessions:
- Architectural decisions (and WHY)
- Gotchas discovered (surprising behaviors, failure modes)
- Conventions established (naming, structure, workflow)
- Domain knowledge shared (how systems work, constraints)
- Tradeoffs considered (what was weighed, what won)

Output valid JSON:
{
  "patterns": [
    {
      "category": "decision|gotcha|reference|implementation|tradeoff|arch|api|perf|security",
      "slug": "kebab-case-name",
      "description": "one-line summary for embedding retrieval",
      "body": "Full explanation with context, reasoning, and examples. Include WHY.",
      "confidence": 0.0-1.0,
      "scope": "project|user",
      "source_turns": [0, 1]
    }
  ]
}

Rules:
- Only extract patterns useful for FUTURE work (not one-time fixes)
- Include the "why" — a pattern without reasoning is just trivia
- Prefer fewer high-quality patterns over many shallow ones
- confidence < 0.5 means skip (uncertain if reusable)
- slug must be kebab-case, max 50 chars
- body should be 3-15 lines of actionable content
- Do NOT extract: git commands run, file paths listed, tool call sequences, debugging steps for a specific bug
- DO extract: architectural choices, surprising platform behaviors, reusable conventions, domain rules
- scope: "project" if the pattern is specific to THIS codebase — its architecture,
  file layout, package/library choices, domain rules, or team conventions.
  scope: "user" if the pattern is about a tool, skill, editor/CLI workflow, or
  personal preference that would apply the same way in a different project — e.g.
  "this Claude Code skill behaves like X," a shell/git habit, an IDE setting.
  When genuinely unsure, prefer "project" (safer default — a project-scoped
  insight wrongly kept project-local just needs moving later; a user-scoped
  insight wrongly buried in one project's corpus is easy to lose track of).

If no patterns are worth extracting, output: {"patterns": []}`;

function formatWindow(window: ExtractionWindow, includeThinking: boolean): string {
  const parts: string[] = [];
  for (let i = 0; i < window.turns.length; i++) {
    const turn = window.turns[i];
    parts.push(`--- Turn ${i} (${turn.timestamp}) ---`);
    parts.push(`USER: ${turn.userContent}`);
    if (includeThinking && turn.assistantThinking) {
      parts.push(`THINKING: ${turn.assistantThinking}`);
    }
    if (turn.assistantText) {
      parts.push(`ASSISTANT: ${turn.assistantText}`);
    }
    if (turn.toolCalls.length > 0) {
      const toolSummary = turn.toolCalls.map((t) => t.name).join(', ');
      parts.push(`TOOLS USED: ${toolSummary}`);
    }
  }
  return parts.join('\n\n');
}

/** Truncate window content to stay within token budget. */
function truncateToTokenBudget(content: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n\n[... truncated for token budget]';
}

/** Extract patterns from a single window. */
export async function extractFromWindow(
  window: ExtractionWindow,
  windowIndex: number,
  config: ExtractionConfig
): Promise<ExtractionResult> {
  const content = formatWindow(window, config.includeThinking);
  const truncated = truncateToTokenBudget(content, config.maxInputTokens);

  const prompt = `${EXTRACTION_PROMPT}\n\n--- TRANSCRIPT WINDOW ---\n\n${truncated}`;
  const tokensUsed = Math.ceil(prompt.length / 4);

  const modelConfig: EvalModelConfig = {
    provider: config.provider,
    model: config.model,
    endpoint: config.ollamaEndpoint,
    region: config.bedrockRegion,
    maxTokens: 2048
  };

  let response: string;
  try {
    response = await callEvalModel(prompt, modelConfig);
  } catch (err) {
    // Try fallback if configured
    if (config.fallbackProvider) {
      const fallbackConfig: EvalModelConfig = {
        provider: config.fallbackProvider,
        model: config.fallbackModel,
        endpoint: config.ollamaEndpoint,
        region: config.bedrockRegion,
        maxTokens: 2048
      };
      response = await callEvalModel(prompt, fallbackConfig);
    } else {
      throw err;
    }
  }

  const patterns = parseExtractionResponse(response, config.confidenceThreshold);
  return { patterns, windowIndex, tokensUsed };
}

export interface ExtractionConfig {
  provider: 'bedrock' | 'ollama' | 'anthropic';
  model: string;
  fallbackProvider?: 'bedrock' | 'ollama' | 'anthropic';
  fallbackModel?: string;
  ollamaEndpoint?: string;
  bedrockRegion?: string;
  confidenceThreshold: number;
  includeThinking: boolean;
  maxInputTokens: number;
}

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  provider: 'bedrock',
  model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  fallbackProvider: 'ollama',
  fallbackModel: 'qwen2.5:3b',
  confidenceThreshold: 0.6,
  includeThinking: true,
  maxInputTokens: 6000
};

function parseExtractionResponse(
  response: string,
  confidenceThreshold: number
): ExtractedPattern[] {
  // Find JSON in the response (may be wrapped in markdown code block)
  const jsonMatch = response.match(/\{[\s\S]*"patterns"[\s\S]*\}/);
  if (!jsonMatch) return [];

  let parsed: { patterns?: Array<Record<string, unknown>> };
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.patterns)) return [];

  return parsed.patterns
    .filter((p) => {
      if (typeof p.confidence !== 'number' || p.confidence < confidenceThreshold) return false;
      if (typeof p.category !== 'string' || !VALID_CATEGORIES.includes(p.category)) return false;
      if (typeof p.slug !== 'string' || !p.slug) return false;
      if (typeof p.description !== 'string' || !p.description) return false;
      if (typeof p.body !== 'string' || !p.body) return false;
      return true;
    })
    .map((p) => ({
      category: p.category as string,
      slug: (p.slug as string).slice(0, 50),
      description: p.description as string,
      body: p.body as string,
      confidence: p.confidence as number,
      // Fail closed to 'project' on anything other than the literal 'user' —
      // an omitted field, a typo, or a model that ignores the instruction
      // should never silently scatter a pattern into the user's cross-project
      // corpus. See the ExtractedPattern.scope doc comment for the rationale.
      scope: p.scope === 'user' ? 'user' : 'project',
      sourceTurns: Array.isArray(p.source_turns) ? (p.source_turns as number[]) : []
    }));
}
