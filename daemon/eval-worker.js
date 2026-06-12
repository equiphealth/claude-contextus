#!/usr/bin/env node

/**
 * Evaluation Worker - Background processor for calibration evaluations
 *
 * Runs as a separate process, consuming jobs from .eval-queue.jsonl
 * and processing them asynchronously without blocking Claude's responses.
 *
 * Usage: node eval-worker.js
 * (or run as systemd service / launchd daemon)
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const EVAL_QUEUE_PATH = path.join(process.env.HOME, '.contextus/.eval-queue.jsonl');
const USAGE_LOG_PATH = path.join(process.env.HOME, '.contextus/logs/usage.jsonl');
const CONFIG_PATH = path.join(process.env.HOME, '.contextus/config.json');

const RATING_WEIGHTS = {
  critical: 1.0,
  helpful: 0.7,
  mentioned: 0.3,
  unused: 0.0
};

class EvaluationWorker {
  constructor() {
    this.processing = false;
    this.sampleCount = 0;
    this.config = this.loadConfig();
  }

  loadConfig() {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  }

  async start() {
    console.log('[EVAL-WORKER] Started');

    // Watch eval queue for new jobs
    fs.watch(EVAL_QUEUE_PATH, async (eventType) => {
      if (eventType === 'change' && !this.processing) {
        await this.processQueue();
      }
    });

    // Initial processing
    await this.processQueue();
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;

    try {
      const jobs = this.readQueue();

      for (const job of jobs) {
        await this.processJob(job);
      }

      // Clear processed jobs
      fs.writeFileSync(EVAL_QUEUE_PATH, '');

    } catch (error) {
      console.error(`[EVAL-WORKER] Error: ${error.message}`);
    } finally {
      this.processing = false;
    }
  }

  readQueue() {
    if (!fs.existsSync(EVAL_QUEUE_PATH)) return [];

    const content = fs.readFileSync(EVAL_QUEUE_PATH, 'utf-8').trim();
    if (!content) return [];

    return content.split('\n').map(line => JSON.parse(line));
  }

  async processJob(job) {
    const { prompt, thinking, response, patterns, model } = job;

    console.log(`[EVAL-WORKER] Processing job (${patterns.length} patterns)`);

    try {
      // Build evaluation prompt
      const evalPrompt = this.buildEvaluationPrompt(prompt, thinking, response, patterns);

      // Call evaluation model
      const ratings = await this.callEvaluationModel(evalPrompt, model);

      // Calculate weighted score
      const weightedScore = this.calculateWeightedScore(ratings);

      // Log calibration_eval event
      const evalEvent = {
        type: 'calibration_eval',
        timestamp: new Date().toISOString(),
        project: path.basename(process.cwd()),
        prompt_hash: this.hashPrompt(prompt),
        retrieved: patterns.map(p => p.id),
        evaluations: ratings,
        weighted_score: weightedScore,
        evaluation_latency_ms: Date.now() - new Date(job.timestamp).getTime()
      };

      fs.appendFileSync(USAGE_LOG_PATH, JSON.stringify(evalEvent) + '\n');

      // Increment sample counter, check if done
      this.sampleCount++;
      console.log(`[EVAL-WORKER] Sample ${this.sampleCount}/${this.config.calibration.targetSamples}`);

      if (this.sampleCount >= this.config.calibration.targetSamples) {
        await this.completeCalibration();
      }

    } catch (error) {
      console.error(`[EVAL-WORKER] Job failed: ${error.message}`);
    }
  }

  buildEvaluationPrompt(prompt, thinking, response, patterns) {
    const patternList = patterns.map((p, i) =>
      `${i + 1}. ${p.id}: ${p.snippet}`
    ).join('\n');

    return `User prompt: ${prompt}

Context patterns injected:
${patternList}

Claude's thinking: ${thinking}

Claude's response: ${response}

Which patterns did Claude use? Reply: number:rating

Ratings:
- critical: Essential to the response, answer would be wrong/incomplete without it
- helpful: Improved the answer, provided useful detail
- mentioned: Referenced but not central
- unused: Injected but not relevant

Reply format: "1:critical, 3:helpful, 4:mentioned, 2:unused, 5:unused"`;
  }

  async callEvaluationModel(prompt, modelConfig) {
    if (modelConfig.provider === 'anthropic') {
      return await this.callAnthropic(prompt, modelConfig.model);
    } else if (modelConfig.provider === 'ollama') {
      return await this.callOllama(prompt, modelConfig.model, modelConfig.endpoint);
    } else {
      throw new Error(`Unknown provider: ${modelConfig.provider}`);
    }
  }

  async callAnthropic(prompt, model) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: model || 'claude-haiku-4',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    return this.parseEvaluationResponse(text);
  }

  async callOllama(prompt, model, endpoint) {
    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama3.1:8b',
        prompt: prompt,
        stream: false
      })
    });

    const data = await response.json();
    return this.parseEvaluationResponse(data.response);
  }

  parseEvaluationResponse(text) {
    // Parse "1:critical, 2:helpful, 3:unused" format
    const ratings = [];
    const matches = text.matchAll(/(\d+):(critical|helpful|mentioned|unused)/gi);

    for (const match of matches) {
      ratings.push({
        pattern_index: parseInt(match[1]) - 1,  // Convert to 0-indexed
        rating: match[2].toLowerCase()
      });
    }

    return ratings;
  }

  calculateWeightedScore(ratings) {
    if (ratings.length === 0) return 0;

    const totalWeight = ratings.reduce((sum, r) =>
      sum + RATING_WEIGHTS[r.rating], 0
    );

    return totalWeight / ratings.length;
  }

  hashPrompt(prompt) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(prompt).digest('hex').substring(0, 8);
  }

  async completeCalibration() {
    console.log('[EVAL-WORKER] Calibration complete, disabling...');

    // Disable evaluateUsage
    this.config.calibration.evaluateUsage = false;
    this.config.calibration.completedAt = new Date().toISOString();

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));

    console.log('[EVAL-WORKER] Run /context-calibrate --report to see results');
  }
}

// Start worker
const worker = new EvaluationWorker();
worker.start().catch(console.error);
