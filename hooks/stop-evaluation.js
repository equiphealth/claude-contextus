#!/usr/bin/env node

/**
 * Stop Hook: Context Usage Evaluation
 *
 * Fires after Claude's complete response to evaluate whether injected
 * context patterns were actually used. Runs only during calibration mode.
 *
 * Flow:
 * 1. Read Stop hook payload from stdin
 * 2. Retrieve injected patterns from session state
 * 3. Call evaluation model (Haiku/Ollama) to rate pattern usage
 * 4. Log calibration_eval event
 * 5. Increment sample counter, auto-disable after targetSamples
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Configuration paths
const CONFIG_PATH = path.join(process.env.HOME, '.contextus/config.json');
const SESSION_STATE_PATH = path.join(process.env.HOME, '.contextus/.session-state.json');
const USAGE_LOG_PATH = path.join(process.env.HOME, '.contextus/logs/usage.jsonl');

async function main() {
  try {
    // 1. Read Stop hook payload from stdin
    const input = await readStdin();
    if (!input) {
      console.error('[EVAL] No input received');
      process.exit(0);
    }

    const payload = JSON.parse(input);
    const { user_message, assistant_message, preceding_reasoning } = payload;

    // 2. Check if calibration mode is active
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    if (!config.calibration?.evaluateUsage) {
      // Calibration not active, skip evaluation
      process.exit(0);
    }

    // 3. Retrieve injected patterns from session state
    const sessionState = JSON.parse(fs.readFileSync(SESSION_STATE_PATH, 'utf-8'));
    const { injected_patterns } = sessionState;

    if (!injected_patterns || injected_patterns.length === 0) {
      // No context injected this turn, nothing to evaluate
      process.exit(0);
    }

    console.error(`[EVAL] Evaluating ${injected_patterns.length} patterns...`);

    // 4. Quick heuristic checks before calling LLM
    const contextMentioned = preceding_reasoning.toLowerCase().includes('context') ||
                             preceding_reasoning.toLowerCase().includes('pattern') ||
                             preceding_reasoning.toLowerCase().includes('inject');

    if (!contextMentioned) {
      console.error('[EVAL] Warning: Thinking does not mention injected context');
    }

    // 5. Queue async evaluation (non-blocking)
    // Write evaluation job to queue, processed by background worker
    const evalJob = {
      timestamp: new Date().toISOString(),
      prompt: user_message,
      thinking: preceding_reasoning,
      response: assistant_message,
      patterns: injected_patterns,
      model: config.models?.evaluation || { provider: 'anthropic', model: 'claude-haiku-4' }
    };

    const EVAL_QUEUE_PATH = path.join(process.env.HOME, '.contextus/.eval-queue.jsonl');
    fs.appendFileSync(EVAL_QUEUE_PATH, JSON.stringify(evalJob) + '\n');

    console.error('[EVAL] Queued for background evaluation');

    // 6. Exit immediately (non-blocking)
    process.exit(0);

  } catch (error) {
    console.error(`[EVAL] Error: ${error.message}`);
    // Never block Claude's response on evaluation errors
    process.exit(0);
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}

main();
