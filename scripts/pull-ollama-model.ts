#!/usr/bin/env tsx
/**
 * pull-ollama-model — Pull embedding models for Ollama.
 *
 * Used by /contextus-setup skill after Ollama installation.
 */

import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execCb);

export const OLLAMA_MODELS = [
  {
    name: 'nomic-embed-text',
    size: '274MB',
    description: 'recommended, best quality/speed balance',
    default: true as const
  },
  {
    name: 'mxbai-embed-large',
    size: '670MB',
    description: 'higher quality, slower',
    default: false as const
  },
  {
    name: 'all-minilm',
    size: '45MB',
    description: 'tiny, fast, lower quality',
    default: false as const
  }
] as const;

export async function pullModel(
  model: string,
  onProgress: (msg: string) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    onProgress(`Pulling ${model}...`);
    await exec(`ollama pull ${model}`);

    // Verify model was pulled
    const { stdout } = await exec('ollama list');
    if (!stdout.includes(model)) {
      return { success: false, error: 'Model pull completed but not in list' };
    }

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

export async function checkModelInstalled(model: string): Promise<boolean> {
  try {
    const { stdout } = await exec('ollama list');
    return stdout.includes(model);
  } catch {
    return false;
  }
}

// CLI mode: pull default model if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const defaultModel = OLLAMA_MODELS.find((m) => m.default)!.name;
  const model = process.argv[2] || defaultModel;

  console.log(`Pulling model: ${model}`);

  pullModel(model, (msg) => console.log(msg))
    .then((result) => {
      if (result.success) {
        console.log(`✓ Model ${model} pulled successfully`);
        process.exit(0);
      } else {
        console.error(`✗ Pull failed: ${result.error}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('Pull error:', err);
      process.exit(1);
    });
}
